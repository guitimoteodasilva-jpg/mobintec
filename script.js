
  const SERVIDOR = "https://SEU-SERVIDOR";

  let vozesPt = [];
  let indiceVoz = 0;
  let vozEscolhida = null;
  let mensagemAtual = "Nenhuma imagem analisada.";
  let analisando = false;

  const seletorFoto = document.getElementById("foto-assentos");
  const resultadoEl = document.getElementById("resultado-assentos");
  const horarioEl = document.getElementById("horario-analise");
  const tela1El = document.getElementById("tela1");
  const tela2El = document.getElementById("tela2");

  // ---------- Voz ----------

  function escolherVoz() {
    if (!("speechSynthesis" in window)) return;

    const vozes = window.speechSynthesis.getVoices();

    vozesPt = vozes.filter(voz =>
      voz.lang && voz.lang.toLowerCase().startsWith("pt")
    );

    if (!vozEscolhida && vozesPt.length > 0) {
      vozEscolhida =
        vozesPt.find(voz => voz.lang.toLowerCase() === "pt-br") ||
        vozesPt[0];
    }

    atualizarLabelVoz();
  }

  function atualizarLabelVoz() {
    const el = document.getElementById("voz-atual");
    if (!el) return;

    el.textContent = vozEscolhida
      ? "Voz: " + vozEscolhida.name
      : "Voz: português padrão do dispositivo";
  }

  function falar(texto) {
    if (!("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();

    const fala = new SpeechSynthesisUtterance(texto);
    fala.lang = "pt-BR";
    fala.rate = 0.95;

    if (vozEscolhida) fala.voice = vozEscolhida;

    window.speechSynthesis.speak(fala);
  }

  function trocarVoz() {
    if (vozesPt.length === 0) {
      falar("Nenhuma voz alternativa em português foi encontrada.");
      return;
    }

    const atual = vozesPt.findIndex(voz =>
      voz.voiceURI === vozEscolhida?.voiceURI
    );

    indiceVoz = (atual + 1) % vozesPt.length;
    vozEscolhida = vozesPt[indiceVoz];

    atualizarLabelVoz();
    falar("Esta é a voz " + vozEscolhida.name);
  }

  if ("speechSynthesis" in window) {
    escolherVoz();
    window.speechSynthesis.addEventListener(
      "voiceschanged",
      escolherVoz
    );
  }

  // ---------- Telas ----------

  function mudarTela(idTela) {
    document.querySelectorAll(".screen").forEach(tela => {
      const ativa = tela.id === idTela;

      tela.classList.toggle("active", ativa);
      tela.hidden = !ativa;
    });

    if (idTela === "tela1") {
      falar("Toque para selecionar uma foto do ônibus.");
    }

    if (idTela === "tela2") {
      falar("Analisando a foto dos assentos. Aguarde.");
    }

    // A leitura do resultado fica no botão para também funcionar
    // em navegadores que exigem um toque para iniciar o áudio.
  }

  function mostrarResultado(mensagem, horario = "") {
    mensagemAtual = mensagem;
    resultadoEl.textContent = mensagem;
    horarioEl.textContent = horario;

    mudarTela("tela3");

    document.querySelector("#tela3 button").focus();
  }

  function repetirMensagem() {
    falar(mensagemAtual);
  }

  // ---------- Seleção e envio da foto ----------

  function selecionarFoto() {
    if (analisando) return;

    seletorFoto.value = "";
    seletorFoto.click();
  }

  seletorFoto.addEventListener("change", () => {
    const arquivo = seletorFoto.files?.[0];

    // Se o usuário cancelar o seletor, não faz nada.
    if (arquivo) analisarFoto(arquivo);
  });

  async function analisarFoto(arquivo) {
    if (analisando) return;

    if (!arquivo.type.startsWith("image/")) {
      mostrarResultado("Selecione um arquivo de imagem.");
      return;
    }

    if (SERVIDOR === "https://SEU-SERVIDOR") {
      mostrarResultado(
        "O servidor de análise ainda não foi configurado. " +
        "Nenhuma análise foi realizada."
      );
      return;
    }

    analisando = true;
    tela2El.setAttribute("aria-busy", "true");
    horarioEl.textContent = "";
    mudarTela("tela2");

    const controlador = new AbortController();

    // Limite de espera. Não é uma previsão de duração.
    const limite = setTimeout(() => {
      controlador.abort();
    }, 120000);

    try {
      const formulario = new FormData();
      formulario.append("image", arquivo);

      const resposta = await fetch(
        SERVIDOR.replace(/\/$/, "") + "/api/analisar",
        {
          method: "POST",
          body: formulario,
          signal: controlador.signal
        }
      );

      if (!resposta.ok) {
        throw new Error("Falha HTTP " + resposta.status);
      }

      const dados = await resposta.json();

      if (
        typeof dados.mensagem !== "string" ||
        !dados.mensagem.trim()
      ) {
        throw new Error("Resposta sem mensagem válida.");
      }

      let horario = "Horário da captura não informado.";

      if (dados.capturadoEm) {
        const data = new Date(dados.capturadoEm);

        if (!Number.isNaN(data.getTime())) {
          horario =
            "Foto capturada em " +
            data.toLocaleString("pt-BR");
        }
      }

      mostrarResultado(dados.mensagem.trim(), horario);

    } catch (erro) {
      console.error("Erro na análise:", erro);

      const mensagem = erro.name === "AbortError"
        ? "A análise excedeu o tempo de espera. " +
          "Não foi possível atualizar a disponibilidade."
        : "Não foi possível analisar a foto. " +
          "Verifique sua conexão e tente novamente.";

      // Não reaproveita uma indicação antiga de lugar livre.
      mostrarResultado(mensagem);

    } finally {
      clearTimeout(limite);
      analisando = false;
      tela2El.setAttribute("aria-busy", "false");
    }
  }

  // Evita que Enter no botão de trocar voz
  // também abra o seletor de fotos.
  tela1El.addEventListener("keydown", evento => {
    if (evento.target !== tela1El) return;

    if (evento.key === "Enter" || evento.key === " ") {
      evento.preventDefault();
      selecionarFoto();
    }
  });

  // ---------- Relógio ----------

  function atualizarHora() {
    document.getElementById("hora").textContent =
      new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit"
      });
  }

  atualizarHora();
  setInterval(atualizarHora, 30000);

