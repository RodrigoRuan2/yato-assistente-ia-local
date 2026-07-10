// main.js — o processo principal do Electron: hospeda a página do avatar
// (a pasta ../avatar/) numa janela TRANSPARENTE. É o "novo projetor" que
// substitui o pywebview/WebView2 (que não fazia transparência no Windows).
//
// TESTE inicial: só abrir a janela transparente com o Natori. A ponte de
// controle (receber comandos do Yato) entra depois, se a transparência colar.

const { app, BrowserWindow, ipcMain, screen } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PASTA_WEB = path.join(__dirname, "..", "avatar");
const PORTA = 8137;

let janela = null;   // referência à janela, pra a PONTE de controle chamar o JS

// content-type por extensão — o Live2D carrega json/png/moc3, cada um precisa
// do tipo certo pro navegador aceitar.
const TIPOS = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png",
  ".moc3": "application/octet-stream",
};

function iniciarServidor() {
  // Servidor http local (contexto http://, sem dor de CORS de file://).
  http.createServer((req, res) => {
    let rota = decodeURIComponent(req.url.split("?")[0]);

    // PONTE DE CONTROLE: o Yato (outro processo) manda comandos por HTTP e a
    // gente repassa pro JavaScript da página. É o mesmo canal que o avatar_app.py
    // (pywebview) usava — ex.: /controle?acao=boca&valor=0.8 → window.setBoca(0.8).
    if (rota === "/controle") {
      atenderControle(req, res);
      return;
    }

    if (rota === "/") rota = "/index.html";
    const arquivo = path.join(PASTA_WEB, rota);
    fs.readFile(arquivo, (err, dados) => {
      if (err) { res.writeHead(404); res.end("nao encontrado"); return; }
      const ext = path.extname(arquivo).toLowerCase();
      res.writeHead(200, { "Content-Type": TIPOS[ext] || "application/octet-stream" });
      res.end(dados);
    });
  }).listen(PORTA, "127.0.0.1");
}

function atenderControle(req, res) {
  // Lê os parâmetros (?acao=...&valor=...&nome=...) e chama a função global
  // certa dentro da página. executeJavaScript é o equivalente Electron do
  // evaluate_js do pywebview.
  const params = new URL(req.url, `http://127.0.0.1:${PORTA}`).searchParams;
  const acao = params.get("acao");
  if (janela && !janela.isDestroyed()) {
    if (acao === "boca") {
      const valor = parseFloat(params.get("valor") || "0");
      janela.webContents.executeJavaScript(`window.setBoca(${valor})`).catch(() => {});
    } else if (acao === "expressao") {
      const nome = params.get("nome") || "";
      janela.webContents.executeJavaScript(`window.setExpressao(${JSON.stringify(nome)})`).catch(() => {});
    }
  }
  res.writeHead(200);
  res.end("ok");
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 320,
    height: 580,
    transparent: true,     // ← o pulo do gato que o WebView2 não fazia
    frame: false,          // sem moldura (mascote)
    alwaysOnTop: true,     // sempre por cima
    resizable: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });
  janela.loadURL(`http://127.0.0.1:${PORTA}/index.html`);

  // "Sempre por cima" REFORÇADO: o alwaysOnTop simples perde pra apps em tela
  // cheia / troca de janela (alt-tab). O nível "screen-saver" é o mais alto do
  // Electron — a janela fica acima até de jogos/vídeos em tela cheia. E
  // setVisibleOnAllWorkspaces faz o mascote acompanhar você por todas as áreas
  // de trabalho virtuais, em vez de sumir quando você troca.
  janela.setAlwaysOnTop(true, "screen-saver");
  janela.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // CLICK-THROUGH INTELIGENTE: por padrão a janela deixa o clique ATRAVESSAR
  // (as partes vazias do avatar não roubam o clique de quem está atrás). Ela só
  // vira "sólida" (arrastável) quando o cursor está sobre o TORSO do personagem.
  janela.setIgnoreMouseEvents(true, { forward: true });

  // A detecção mora AQUI no main, NÃO na página — de propósito. Os eventos de
  // mouse "forwarded" pra página só chegam quando o avatar está em FOCO; depois
  // de um alt-tab paravam e o avatar "congelava". O main, em vez disso, consulta
  // a posição GLOBAL do cursor (screen.getCursorScreenPoint), que funciona
  // sempre — com foco ou sem. O retângulo do TORSO abaixo é o MESMO #arraste do
  // estilo.css (se afinar um, afine o outro).
  const TORSO = { top: 0.30, bottom: 0.18, left: 0.24, right: 0.24 };
  let solido = false;
  setInterval(() => {
    if (!janela || janela.isDestroyed()) return;
    const b = janela.getBounds();
    const p = screen.getCursorScreenPoint();
    const dentro =
      p.x >= b.x + b.width * TORSO.left &&
      p.x <= b.x + b.width * (1 - TORSO.right) &&
      p.y >= b.y + b.height * TORSO.top &&
      p.y <= b.y + b.height * (1 - TORSO.bottom);
    if (dentro !== solido) {
      solido = dentro;
      // dentro do torso → captura o clique (arrasta); fora → deixa atravessar.
      janela.setIgnoreMouseEvents(!dentro, { forward: true });
    }
  }, 50);

  // Rede de segurança pro FECHAR: escuta o ESC direto aqui no main (não
  // depende do preload/IPC). Se o IPC falhar, o ESC ainda fecha.
  janela.webContents.on("before-input-event", (evento, input) => {
    if (input.type === "keyDown" && input.key === "Escape") app.quit();
  });
}

// A página (botão ✕) pede pra fechar por aqui.
ipcMain.on("fechar-avatar", () => {
  console.log("[main] IPC fechar-avatar recebido");
  app.quit();
});

app.whenReady().then(() => {
  iniciarServidor();
  criarJanela();
});

app.on("window-all-closed", () => app.quit());
