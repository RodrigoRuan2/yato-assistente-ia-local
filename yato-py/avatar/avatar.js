// avatar.js — carrega modelos Live2D de teste e deixa VOCÊ trocar entre eles
// por um seletor, pra achar o que combina com o Yato. (Fase de exploração.)

// Os modelos de teste (do repositório oficial CubismWebSamples da Live2D).
// Ficaram só os dois que combinaram com o palco/enquadramento do Yato. São
// MANEQUINS de desenvolvimento — o Yato riggado entra aqui no futuro.
const BASE =
  "https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources";

const MODELOS = {
  "Natori": `${BASE}/Natori/Natori.model3.json`,
  "Mao": `${BASE}/Mao/Mao.model3.json`,
};

// O PIXI é o "motor de desenho". backgroundAlpha: 0 = canvas transparente
// (deixa o fundo do CSS aparecer; na janela flutuante vira a transparência).
const app = new PIXI.Application({
  view: document.getElementById("palco"),
  resizeTo: window,
  backgroundAlpha: 0,
  antialias: true,
});

let modelo = null;
let bocaAlvo = 0;

// Carrega um modelo por URL, tirando o anterior antes (libera memória).
async function carregar(url) {
  if (modelo) {
    app.stage.removeChild(modelo);
    // Libera TAMBÉM as texturas na placa de vídeo. Sem o texture/baseTexture,
    // cada troca vaza memória de vídeo e, depois de algumas, o WebGL "estoura"
    // e a tela fica branca (foi o que aconteceu ao testar vários modelos).
    modelo.destroy({ children: true, texture: true, baseTexture: true });
    modelo = null;
  }
  try {
    modelo = await PIXI.live2d.Live2DModel.from(url);
    app.stage.addChild(modelo);
    encaixar();
    instalarLipSync();
    console.log("[avatar] carregado:", url);
  } catch (e) {
    console.error("[avatar] FALHOU:", url, e);
  }
}

// Enquadra tipo VTuber: ZOOM no busto (rosto + tronco), não o corpo inteiro —
// assim o rosto fica grande e dá pra VER a boca mexer. A cabeça encosta perto
// do topo e as pernas ficam pra fora, embaixo (como numa webcam de streamer).
const ZOOM_BUSTO = 1.9;   // quanto do corpo cabe (maior = mais perto do rosto)

function encaixar() {
  if (!modelo) return;
  const m = modelo.internalModel;
  const escala = (window.innerWidth / m.width) * ZOOM_BUSTO;
  modelo.scale.set(escala);
  modelo.anchor.set(0.5, 0.0);   // âncora no TOPO-centro do modelo
  modelo.position.set(window.innerWidth / 2, window.innerHeight * 0.04);
}

// O Cubism REDEFINE os parâmetros pro padrão a cada frame — então setar a
// boca "de fora" não gruda. A solução: nos pendurar DEPOIS do update dos
// movimentos e cravar a boca no valor do lip-sync ali. Nada depois disso
// mexe na boca, então o valor sobrevive.
function instalarLipSync() {
  const im = modelo.internalModel;
  // Descobre QUAIS parâmetros movem a boca DESTE modelo — cada um usa nomes
  // diferentes (o Natori usa "ParamMouthOpenY", a Mao usa "ParamA"). O próprio
  // model3.json declara isso no grupo "LipSync"; se faltar, cai no padrão.
  const grupos = (im.settings && im.settings.groups) || [];
  const lip = grupos.find((g) => g.Name === "LipSync");
  const bocaIds = lip && lip.Ids && lip.Ids.length ? lip.Ids : ["ParamMouthOpenY"];

  const gerente = im.motionManager;
  const updateOriginal = gerente.update.bind(gerente);
  gerente.update = function (coreModel, agora) {
    const r = updateOriginal(coreModel, agora);
    for (const id of bocaIds) {
      im.coreModel.setParameterValueById(id, bocaAlvo);   // crava a boca
    }
    return r;
  };
}

// Monta o menu de modelos a partir da lista e liga a troca. 'padrao' é o
// nome do modelo que já vem selecionado.
function montarSeletor(padrao) {
  const seletor = document.getElementById("seletor");
  for (const nome in MODELOS) {
    const opcao = document.createElement("option");
    opcao.value = MODELOS[nome];
    opcao.textContent = nome;
    if (nome === padrao) opcao.selected = true;
    seletor.appendChild(opcao);
  }
  seletor.addEventListener("change", (e) => carregar(e.target.value));
}

// ─────────────────────── O CONTRATO (Python → JS) ───────────────────────
// Estas funções globais são o que o processo Python vai chamar via pywebview.

// Lip-sync: abre a boca conforme o volume da voz (0.0 fechada … 1.0 aberta).
window.setBoca = function (valor) {
  bocaAlvo = Math.max(0, Math.min(1, valor));
};

// Troca a expressão (ociosa/pensando/falando/feliz), se o modelo tiver.
window.setExpressao = function (nome) {
  if (!modelo) return;
  try {
    modelo.expression(nome);
  } catch (e) {
    console.warn("[avatar] expressão indisponível:", nome);
  }
};

// Raio-X de desenvolvimento: chamar window.avatarDebug() no console mostra se
// o render está vivo (FPS), se o modelo está na tela e se o WebGL está são.
window.avatarDebug = () => ({
  temModelo: !!modelo,
  visivel: modelo ? modelo.visible : null,
  escala: modelo ? Number(modelo.scale.x.toFixed(3)) : null,
  x: modelo ? Math.round(modelo.x) : null,
  y: modelo ? Math.round(modelo.y) : null,
  larguraModelo: modelo ? Math.round(modelo.width) : null,
  fps: Math.round(app.ticker.FPS),
  filhosNoPalco: app.stage.children.length,
  contextoPerdido: app.renderer.gl ? app.renderer.gl.isContextLost() : "n/a",
});

// Fechar o mascote. Só tem efeito na janela do pywebview (onde window.pywebview
// existe e conversa com o Python); no navegador comum de teste, fica inerte.
function fecharAvatar() {
  if (window.pywebview && window.pywebview.api && window.pywebview.api.fechar) {
    window.pywebview.api.fechar();
  }
}
document.getElementById("fechar").addEventListener("click", fecharAvatar);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") fecharAvatar();
});

window.addEventListener("resize", encaixar);
montarSeletor("Natori");
carregar(MODELOS["Natori"]);   // o manequim escolhido pro desenvolvimento
