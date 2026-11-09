
"use strict";

// Somente o endereço público do backend.
// Nunca coloque sua chave Roboflow neste arquivo.
const SERVIDOR = "https://mobintec-backend.onrender.com";

const PAUSA_MS = 3000;
const PAUSA_ERRO_MS = 8000;
const VALIDADE_MS = 15000;
const TIMEOUT_MS = 45000;

const el = id => document.getElementById(id);

const video = el("video");
const canvas = el("canvas");

let stream = null;
let ativo = false;
let sessao = 0;
let pedido = null;
let proximaAnalise = null;
let expiracao = null;

let mensagemAtual = "";
let instanteCapturaAtual = 0;
let ultimaFalada = "";
let ultimoErroFalado = "";

let vozes = [];
let voz = null;

// ---------- Interface ----------

function tela(id) {
  ["tela1", "tela2", "tela3"].forEach(nome => {
    el(nome).hidden = nome !== id;
  });
}

function status(texto) {
  el("status").textContent = texto;
}

function cancelarVoz() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function limparResultado() {
  clearTimeout(expiracao);
  expiracao = null;
  mensagemAtual = "";
  instanteCapturaAtual = 0;
  el("repetir").disabled = true;
  el("horario").textContent = "";
}

function aviso(texto) {
  limparResultado();
  cancelarVoz();
  el("resultado").textContent = texto;
  el("voltar").hidden = ativo;
  tela("tela3");
}

// ---------- Voz ----------

function carregarVozes() {
  if (!("speechSynthesis" in window)) {
    el("voz-atual").textContent = "Voz indisponível neste navegador.";
    return;
  }

  vozes = speechSynthesis.getVoices().filter(
    item => item.lang.toLowerCase().startsWith("pt")
  );

  if (!voz || !vozes.some(item => item.voiceURI === voz.voiceURI)) {
    voz =
      vozes.find(item => item.lang.toLowerCase() === "pt-br") ||
      vozes[0] ||
      null;
  }

  el("voz-atual").textContent = voz
    ? "Voz: " + voz.name
    : "Voz: português padrão do dispositivo";
}

function falar(texto) {
  if (!("speechSynthesis" in window)) return;

  cancelarVoz();

  const fala = new SpeechSynthesisUtterance(texto);
  fala.lang = "pt-BR";
  fala.rate = 1;

  if (voz) fala.voice = voz;

  speechSynthesis.speak(fala);
}

el("trocar-voz").addEventListener("click", () => {
  carregarVozes();

  if (!vozes.length) {
    falar("Usando a voz padrão em português.");
    return;
  }

  const indice = vozes.findIndex(
    item => item.voiceURI === voz?.voiceURI
  );

  voz = vozes[(indice + 1) % vozes.length];

  el("voz-atual").textContent = "Voz: " + voz.name;
  falar("Esta é a voz " + voz.name);
});

if ("speechSynthesis" in window) {
  carregarVozes();
  speechSynthesis.addEventListener("voiceschanged", carregarVozes);
}

// ---------- Câmera ----------

async function iniciar() {
  if (ativo) return;

  if (!window.isSecureContext) {
    aviso("Abra o site por HTTPS para usar a câmera.");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    aviso(
      "Este navegador não oferece acesso à câmera. " +
      "Abra o site diretamente no Chrome ou Safari."
    );
    return;
  }

  ativo = true;
  const minhaSessao = ++sessao;

  el("iniciar").disabled = true;
  el("camera-area").hidden = false;
  el("voltar").hidden = true;

  limparResultado();
  ultimaFalada = "";
  ultimoErroFalado = "";

  tela("tela2");
  status("Solicitando acesso à câmera.");

  try {
    const novaStream = await navigator.mediaDevices.getUserMedia({
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

        parar(false);
        aviso("A câmera foi desconectada. Volte e inicie novamente.");
        status("Câmera desconectada.");
      });
    });

    el("parar").focus();
    falar("Busca iniciada. Mantenha o celular parado.");

    analisar(minhaSessao);
  } catch (erro) {
    if (minhaSessao !== sessao) return;

    parar(false);

    const mensagens = {
      NotAllowedError:
        "Permissão negada. Autorize a câmera nas configurações do navegador.",
      NotFoundError:
        "Nenhuma câmera foi encontrada.",
      NotReadableError:
        "Não foi possível acessar a câmera. Feche outros aplicativos que a utilizam."
    };

    const texto =
      mensagens[erro.name] ||
      "Não foi possível iniciar a câmera.";

    aviso(texto);
    status("Câmera indisponível.");
    falar(texto);
  }
}

function parar(anunciar = true) {
  ativo = false;
  sessao++;

  clearTimeout(proximaAnalise);
  proximaAnalise = null;

  pedido?.abort();
  pedido = null;

  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;

  limparResultado();
  cancelarVoz();

  ultimaFalada = "";
  ultimoErroFalado = "";

  el("camera-area").hidden = true;
  el("iniciar").disabled = false;
  el("voltar").hidden = true;

  tela("tela1");
  status("Câmera e busca desligadas.");

  if (anunciar) {
    el("iniciar").focus();
    falar("Câmera e busca desligadas.");
  }
}

function capturar() {
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

    contexto.drawImage(video, 0, 0, canvas.width, canvas.height);

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

function mostrarResultado(texto, instante) {
  limparResultado();

  mensagemAtual = texto;
  instanteCapturaAtual = instante;

  el("resultado").textContent = texto;
  el("horario").textContent =
    "Captura às " + new Date(instante).toLocaleTimeString("pt-BR");

  el("repetir").disabled = false;
  el("voltar").hidden = true;

  tela("tela3");

  if (texto !== ultimaFalada) {
    falar(texto);
    ultimaFalada = texto;
  }

  const restante = VALIDADE_MS - (Date.now() - instante);

  expiracao = setTimeout(() => {
    limparResultado();
    cancelarVoz();
    ultimaFalada = "";

    el("resultado").textContent =
      "Resultado expirado. Aguarde uma nova análise.";

    status("Sem indicação atual de assento.");
  }, Math.max(0, restante));
}

// ---------- Análise automática ----------

async function analisar(minhaSessao) {
  if (!ativo || minhaSessao !== sessao) return;

  status("Analisando. Mantenha o celular parado.");

  const controle = new AbortController();
  pedido = controle;

  const timeout = setTimeout(() => controle.abort(), TIMEOUT_MS);

  let pausa = PAUSA_MS;

  try {
    const { blob, capturadoEm } = await capturar();

    if (!ativo || minhaSessao !== sessao) return;
    if (controle.signal.aborted) {
      throw new DOMException("Tempo esgotado", "AbortError");
    }

    const requisicaoId =
      globalThis.crypto?.randomUUID?.() ||
      `${minhaSessao}-${Date.now()}`;

    const formulario = new FormData();
    formulario.append("image", blob, "camera.jpg");
    formulario.append("capturadoEm", capturadoEm);
    formulario.append("requisicaoId", requisicaoId);

    const resposta = await fetch(SERVIDOR + "/api/analisar", {
      method: "POST",
      body: formulario,
      signal: controle.signal,
      cache: "no-store"
    });

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
    mostrarResultado(dados.mensagem.trim(), instante);
    status("Resultado atualizado. A busca continua.");
  } catch (erro) {
    if (!ativo || minhaSessao !== sessao) return;

    pausa = PAUSA_ERRO_MS;

    const bloqueado = [
      "HTTP_401",
      "HTTP_403",
      "HTTP_503"
    ].includes(erro.message);

    let texto;

    if (bloqueado) {
      texto =
        "O servidor bloqueou o acesso ou ainda não foi configurado. " +
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
        "O servidor demorou demais. Não há indicação atual. " +
        "A busca tentará novamente.";
    } else if (erro.message === "HTTP_429") {
      texto =
        "O servidor limitou as solicitações. Aguarde a próxima tentativa.";
      pausa = 30000;
    } else {
      texto =
        "Não foi possível atualizar a análise. " +
        "Verifique a conexão. A busca tentará novamente.";
    }

    const deveFalar = texto !== ultimoErroFalado;

    if (bloqueado) {
      parar(false);
    }

    aviso(texto);
    status(ativo ? "Sem resultado atual. Aguardando nova tentativa." : texto);
    ultimaFalada = "";

    if (deveFalar) falar(texto);
    ultimoErroFalado = texto;
  } finally {
    clearTimeout(timeout);

    if (pedido === controle) pedido = null;

    // Nunca envia duas análises simultâneas nesta página.
    if (ativo && minhaSessao === sessao) {
      proximaAnalise = setTimeout(
        () => analisar(minhaSessao),
        pausa
      );
    }
  }
}

// ---------- Controles ----------

el("iniciar").addEventListener("click", iniciar);
el("parar").addEventListener("click", () => parar());

el("voltar").addEventListener("click", () => {
  tela("tela1");
  el("iniciar").focus();
});

el("repetir").addEventListener("click", () => {
  if (
    !mensagemAtual ||
    Date.now() - instanteCapturaAtual >= VALIDADE_MS
  ) {
    aviso("Resultado expirado. Aguarde uma nova análise.");
    return;
  }

  falar(mensagemAtual);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && ativo) parar(false);
});

window.addEventListener("pagehide", () => parar(false));

// Evita continuar usando a orientação anterior após girar a tela.
// Não detecta todos os movimentos físicos do telefone.
screen.orientation?.addEventListener("change", () => {
  if (!ativo) return;

  parar(false);
  aviso("A orientação da tela mudou. Volte e inicie a busca novamente.");
  falar("A orientação da tela mudou. Inicie novamente.");
});

function atualizarHora() {
  el("hora").textContent = new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

atualizarHora();
setInterval(atualizarHora, 30000);
