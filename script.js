
(() => {
  "use strict";

  // Endereço público do backend.
  // Nunca coloque a chave Roboflow neste arquivo.
  const SERVIDOR = "https://mobintec-backend.onrender.com";

  const PAUSA_MS = 3000;
  const PAUSA_ERRO_MS = 8000;
  const VALIDADE_MS = 15000;
  const TIMEOUT_MS = 45000;

  function configurarAplicativo() {
    const buscar = id => document.getElementById(id);

    const ids = [
      "video",
      "canvas",
      "iniciar",
      "parar",
      "trocar-voz",
      "voz-atual",
      "camera-area",
      "tela1",
      "tela2",
      "tela3",
      "resultado",
      "horario",
      "repetir",
      "voltar",
      "status",
      "hora"
    ];

    const elementos = {};
    const faltando = [];

    for (const id of ids) {
      elementos[id] = buscar(id);

      if (!elementos[id]) {
        faltando.push(id);
      }
    }

    if (faltando.length > 0) {
      alert(
        "O HTML e o JavaScript estão em versões diferentes. " +
        "Elementos ausentes: " + faltando.join(", ")
      );
      return;
    }

    const video = elementos.video;
    const canvas = elementos.canvas;

    let stream = null;
    let ativo = false;
    let sessao = 0;
    let pedido = null;
    let proximaAnalise = null;
    let expiracao = null;

    let mensagemAtual = "";
    let instanteResultado = 0;
    let ultimaFalada = "";
    let ultimoErroFalado = "";

    let vozes = [];
    let voz = null;

    // ---------- Interface ----------

    function atualizarStatus(texto) {
      elementos.status.textContent = texto;
    }

    function mudarTela(id) {
      ["tela1", "tela2", "tela3"].forEach(nome => {
        elementos[nome].hidden = nome !== id;
      });
    }

    function cancelarVoz() {
      try {
        if ("speechSynthesis" in window) {
          window.speechSynthesis.cancel();
        }
      } catch (erro) {
        console.warn("Não foi possível interromper a voz.");
      }
    }

    function limparResultado() {
      clearTimeout(expiracao);
      expiracao = null;
      mensagemAtual = "";
      instanteResultado = 0;
      elementos.repetir.disabled = true;
      elementos.horario.textContent = "";
    }

    function mostrarAviso(texto) {
      limparResultado();
      cancelarVoz();

      elementos.resultado.textContent = texto;
      elementos.voltar.hidden = ativo;

      mudarTela("tela3");
    }

    // ---------- Voz ----------
    // Falhas de voz não devem impedir o uso da câmera.

    function carregarVozes() {
      try {
        if (!("speechSynthesis" in window)) {
          elementos["voz-atual"].textContent =
            "Voz indisponível neste navegador.";
          return;
        }

        vozes = window.speechSynthesis.getVoices().filter(
          item => (item.lang || "").toLowerCase().startsWith("pt")
        );

        if (
          !voz ||
          !vozes.some(item => item.voiceURI === voz.voiceURI)
        ) {
          voz =
            vozes.find(
              item => item.lang.toLowerCase() === "pt-br"
            ) ||
            vozes[0] ||
            null;
        }

        elementos["voz-atual"].textContent = voz
          ? "Voz: " + voz.name
          : "Voz: português padrão do dispositivo";
      } catch (erro) {
        elementos["voz-atual"].textContent =
          "Não foi possível carregar as vozes.";
      }
    }
function mensagemParaVoz(texto) {
  const mensagem = String(texto || "").trim();

  if (
    mensagem.startsWith(
      "Candidato a assento livre mais próximo pela posição na imagem:"
    )
  ) {
    if (mensagem.includes("à direita da imagem")) {
      return "Possível assento livre à direita da imagem. Confirme antes de sentar.";
    }

    if (mensagem.includes("à esquerda da imagem")) {
      return "Possível assento livre à esquerda da imagem. Confirme antes de sentar.";
    }

    if (mensagem.includes("na região central da imagem")) {
      return "Possível assento livre no centro da imagem. Confirme antes de sentar.";
    }
  }

  if (
    mensagem.startsWith(
      "Não identifiquei um candidato a assento livre"
    )
  ) {
    return "Nenhum assento livre identificado nesta imagem.";
  }

  // Mantém mensagens de conexão, permissão e outros avisos.
  return mensagem;
}

    function falar(texto) {
      try {
        if (
          !("speechSynthesis" in window) ||
          !("SpeechSynthesisUtterance" in window)
        ) {
          return;
        }

        cancelarVoz();

      const fala = new SpeechSynthesisUtterance(
  mensagemParaVoz(texto)
);

fala.lang = "pt-BR";
fala.rate = 0.95;
fala.volume = 1;
fala.pitch = 1;

        if (voz) {
          fala.voice = voz;
        }

        window.speechSynthesis.speak(fala);
      } catch (erro) {
        console.warn("Voz indisponível; resultado mantido na tela.");
      }
    }

    function trocarVoz() {
      carregarVozes();

      if (vozes.length === 0) {
        falar("Usando a voz padrão do dispositivo.");
        return;
      }

      const indice = vozes.findIndex(
        item => item.voiceURI === voz?.voiceURI
      );

      voz = vozes[(indice + 1) % vozes.length];

      elementos["voz-atual"].textContent = "Voz: " + voz.name;
      falar("Esta é a voz " + voz.name);
    }

    // ---------- Câmera ----------

    function pararCamera(anunciar = true) {
      ativo = false;
      sessao++;

      clearTimeout(proximaAnalise);
      proximaAnalise = null;

      if (pedido) {
        pedido.abort();
        pedido = null;
      }

      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
      }

      video.srcObject = null;

      limparResultado();
      cancelarVoz();

      ultimaFalada = "";
      ultimoErroFalado = "";

      elementos["camera-area"].hidden = true;
      elementos.iniciar.disabled = false;
      elementos.voltar.hidden = true;

      mudarTela("tela1");
      atualizarStatus("Câmera e busca desligadas.");
      falar("Iniciando câmera.");


      if (anunciar) {
        elementos.iniciar.focus();
        falar("Câmera e busca desligadas.");
      }
    }

    async function iniciarCamera() {
      if (ativo) return;

      atualizarStatus("Botão acionado. Preparando a câmera.");

      if (!window.isSecureContext) {
        mostrarAviso("Abra o aplicativo por HTTPS.");
        atualizarStatus("É necessário usar HTTPS.");
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        mostrarAviso(
          "Este navegador não oferece acesso à câmera. " +
          "Abra o link diretamente no Chrome ou Safari."
        );
        atualizarStatus("Câmera indisponível neste navegador.");
        return;
      }

      ativo = true;
      const minhaSessao = ++sessao;

      elementos.iniciar.disabled = true;
      elementos["camera-area"].hidden = false;
      elementos.voltar.hidden = true;

      limparResultado();
      ultimaFalada = "";
      ultimoErroFalado = "";

      mudarTela("tela2");
      atualizarStatus("Autorize o acesso à câmera no navegador.");

      try {
        const novaStream =
          await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }
          });

        if (!ativo || minhaSessao !== sessao) {
          novaStream.getTracks().forEach(track => track.stop());
          return;
        }

        stream = novaStream;
        video.srcObject = stream;

        await video.play();

        if (!ativo || minhaSessao !== sessao) return;

        stream.getVideoTracks().forEach(track => {
          track.addEventListener("ended", () => {
            if (!ativo || minhaSessao !== sessao) return;

            pararCamera(false);
            mostrarAviso(
              "A câmera foi desconectada. Volte e inicie novamente."
            );
            atualizarStatus("Câmera desconectada.");
          });
        });

        elementos.parar.focus();
        atualizarStatus("Câmera ligada. Iniciando análise.");
        falar("Busca iniciada. Mantenha o celular parado.");

        analisarQuadro(minhaSessao);
      } catch (erro) {
        if (minhaSessao !== sessao) return;

        pararCamera(false);

        const mensagens = {
          NotAllowedError:
            "Permissão negada. Autorize a câmera nas configurações do navegador.",
          NotFoundError:
            "Nenhuma câmera foi encontrada.",
          NotReadableError:
            "A câmera está indisponível. Feche outros aplicativos que a utilizam.",
          OverconstrainedError:
            "Não foi possível abrir a câmera com essa configuração."
        };

        const texto =
          mensagens[erro.name] ||
          "Não foi possível iniciar a câmera: " +
            (erro.message || erro.name || "erro desconhecido");

        mostrarAviso(texto);
        atualizarStatus(texto);
        falar(texto);
      }
    }

    function capturarFoto() {
      return new Promise((resolve, reject) => {
        if (
          video.readyState < 2 ||
          !video.videoWidth ||
          !video.videoHeight
        ) {
          reject(new Error("CAMERA_SEM_QUADRO"));
          return;
        }

        const escala = Math.min(1, 1280 / video.videoWidth);

        canvas.width = Math.round(video.videoWidth * escala);
        canvas.height = Math.round(video.videoHeight * escala);

        const contexto = canvas.getContext("2d");

        if (!contexto) {
          reject(new Error("FALHA_CAPTURA"));
          return;
        }

        contexto.drawImage(
          video,
          0,
          0,
          canvas.width,
          canvas.height
        );

        const capturadoEm = new Date().toISOString();

        canvas.toBlob(blob => {
          if (!blob) {
            reject(new Error("FALHA_CAPTURA"));
            return;
          }

          resolve({ blob, capturadoEm });
        }, "image/jpeg", 0.85);
      });
    }

    // ---------- Resultado ----------

    function mostrarResultado(texto, instante, minhaSessao) {
      limparResultado();

      mensagemAtual = texto;
      instanteResultado = instante;

      elementos.resultado.textContent = texto;
      elementos.horario.textContent =
        "Imagem capturada às " +
        new Date(instante).toLocaleTimeString("pt-BR");

      elementos.repetir.disabled = false;
      elementos.voltar.hidden = true;

      mudarTela("tela3");

      if (texto !== ultimaFalada) {
        falar(texto);
        ultimaFalada = texto;
      }

      const restante =
        VALIDADE_MS - (Date.now() - instante);

      expiracao = setTimeout(() => {
        if (!ativo || minhaSessao !== sessao) return;

        limparResultado();
        cancelarVoz();
        ultimaFalada = "";

        elementos.resultado.textContent =
          "Resultado expirado. Aguarde uma nova análise.";

        atualizarStatus("Sem indicação atual de assento.");
      }, Math.max(0, restante));
    }

    // ---------- Análise automática ----------

    async function analisarQuadro(minhaSessao) {
      if (!ativo || minhaSessao !== sessao) return;

      atualizarStatus(
        "Analisando. Mantenha o celular parado."
      );

      const controle = new AbortController();
      pedido = controle;

      const timeout = setTimeout(
        () => controle.abort(),
        TIMEOUT_MS
      );

      let pausa = PAUSA_MS;

      try {
        const { blob, capturadoEm } = await capturarFoto();

        if (!ativo || minhaSessao !== sessao) return;

        if (controle.signal.aborted) {
          throw new DOMException(
            "Tempo esgotado",
            "AbortError"
          );
        }

        const requisicaoId =
          globalThis.crypto?.randomUUID?.() ||
          `${minhaSessao}-${Date.now()}`;

        const formulario = new FormData();
        formulario.append("image", blob, "camera.jpg");
        formulario.append("capturadoEm", capturadoEm);
        formulario.append("requisicaoId", requisicaoId);

        const resposta = await fetch(
          SERVIDOR + "/api/analisar",
          {
            method: "POST",
            body: formulario,
            signal: controle.signal,
            cache: "no-store"
          }
        );

        if (!resposta.ok) {
          throw new Error("HTTP_" + resposta.status);
        }

        const dados = await resposta.json();

        if (!ativo || minhaSessao !== sessao) return;

        if (
          typeof dados.mensagem !== "string" ||
          !dados.mensagem.trim() ||
          dados.capturadoEm !== capturadoEm ||
          dados.requisicaoId !== requisicaoId
        ) {
          throw new Error("RESPOSTA_INVALIDA");
        }

        const instante = Date.parse(capturadoEm);

        if (
          !Number.isFinite(instante) ||
          Date.now() - instante >= VALIDADE_MS
        ) {
          throw new Error("RESULTADO_ANTIGO");
        }

        ultimoErroFalado = "";

        mostrarResultado(
          dados.mensagem.trim(),
          instante,
          minhaSessao
        );

        atualizarStatus(
          "Resultado atualizado. A busca continua."
        );
      } catch (erro) {
        if (!ativo || minhaSessao !== sessao) return;

        pausa = PAUSA_ERRO_MS;

        const interromper = [
          "HTTP_401",
          "HTTP_403",
          "HTTP_503"
        ].includes(erro.message);

        let texto;

        if (
          erro.message === "HTTP_401" ||
          erro.message === "HTTP_403"
        ) {
          texto =
            "A câmera abriu, mas o servidor exige autorização. " +
            "A busca foi interrompida.";
        } else if (erro.message === "HTTP_503") {
          texto =
            "O servidor está indisponível ou não foi configurado. " +
            "A busca foi interrompida.";
        } else if (erro.message === "RESULTADO_ANTIGO") {
          texto =
            "A análise chegou com mais de 15 segundos e foi descartada. " +
            "Não há indicação atual de assento.";
        } else if (
          erro.name === "AbortError" ||
          erro.message === "HTTP_504"
        ) {
          texto =
            "O servidor demorou demais. " +
            "Não há indicação atual de assento. " +
            "A busca tentará novamente.";
        } else if (erro.message === "CAMERA_SEM_QUADRO") {
          texto =
            "A câmera ainda está preparando a imagem. Aguarde.";
          pausa = 2000;
        } else if (erro.message === "HTTP_429") {
          texto =
            "O servidor limitou as solicitações. " +
            "Aguardando antes de tentar novamente.";
          pausa = 30000;
        } else {
          texto =
            "Não foi possível atualizar a análise. " +
            "Verifique a conexão. A busca tentará novamente.";
        }

        const deveFalar = texto !== ultimoErroFalado;

        if (interromper) {
          pararCamera(false);
        }

        mostrarAviso(texto);

        atualizarStatus(
          ativo
            ? "Sem resultado atual. Aguardando nova tentativa."
            : texto
        );

        ultimaFalada = "";
        ultimoErroFalado = texto;

        if (deveFalar) {
          falar(texto);
        }
      } finally {
        clearTimeout(timeout);

        if (pedido === controle) {
          pedido = null;
        }

        // Um pedido por vez nesta página.
        if (ativo && minhaSessao === sessao) {
          proximaAnalise = setTimeout(
            () => analisarQuadro(minhaSessao),
            pausa
          );
        }
      }
    }

    // ---------- Botões ----------
    // Configurados antes da inicialização das vozes.

    elementos.iniciar.addEventListener(
      "click",
      iniciarCamera
    );

    elementos.parar.addEventListener(
      "click",
      () => pararCamera()
    );

    elementos["trocar-voz"].addEventListener(
      "click",
      trocarVoz
    );

    elementos.voltar.addEventListener("click", () => {
      mudarTela("tela1");
      elementos.iniciar.focus();
    });

    elementos.repetir.addEventListener("click", () => {
      if (
        !mensagemAtual ||
        Date.now() - instanteResultado >= VALIDADE_MS
      ) {
        mostrarAviso(
          "Resultado expirado. Aguarde uma nova análise."
        );
        return;
      }

      falar(mensagemAtual);
    });

    // ---------- Interrupções ----------

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && ativo) {
        pararCamera(false);
      }
    });

    window.addEventListener(
      "pagehide",
      () => pararCamera(false)
    );

    function aoGirarTela() {
      if (!ativo) return;

      pararCamera(false);
      mostrarAviso(
        "A orientação da tela mudou. Volte e inicie novamente."
      );
      falar(
        "A orientação da tela mudou. Inicie novamente."
      );
    }

    if (
      window.screen?.orientation &&
      typeof window.screen.orientation.addEventListener === "function"
    ) {
      window.screen.orientation.addEventListener(
        "change",
        aoGirarTela
      );
    }

    // ---------- Inicialização ----------

    function atualizarHora() {
      elementos.hora.textContent =
        new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit"
        });
    }

    atualizarHora();
    setInterval(atualizarHora, 30000);

    atualizarStatus(
      "Aplicativo carregado. Toque em Iniciar câmera."
    );

    carregarVozes();

    try {
      if (
        "speechSynthesis" in window &&
        typeof window.speechSynthesis.addEventListener === "function"
      ) {
        window.speechSynthesis.addEventListener(
          "voiceschanged",
          carregarVozes
        );
      }
    } catch (erro) {
      console.warn("Atualização automática de vozes indisponível.");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      configurarAplicativo,
      { once: true }
    );
  } else {
    configurarAplicativo();
  }
})();
