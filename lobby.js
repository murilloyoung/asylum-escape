// Tela de lobby (HTML): criar sala, entrar com codigo e ver os jogadores.
import { net, MAX_PLAYERS } from "./net.js";

export function initLobby({ onStart }) {
  const $ = (id) => document.getElementById(id);
  const root = $("mp-lobby");
  const home = $("mp-home");
  const room = $("mp-room");
  const status = $("mp-status");
  const nameInput = $("mp-name");
  const codeInput = $("mp-code");
  const createBtn = $("mp-create");
  const joinBtn = $("mp-join");
  const backBtn = $("mp-back");
  const copyBtn = $("mp-copy");
  const startBtn = $("mp-start");
  const leaveBtn = $("mp-leave");
  const codeEl = $("mp-room-code");
  const listEl = $("mp-players");
  const hintEl = $("mp-room-hint");

  try {
    nameInput.value = localStorage.getItem("asylum-mp-name") || "";
  } catch (error) {
    /* localStorage indisponivel */
  }

  // Digitar nos campos nao pode acionar as teclas do jogo (WASD, espaco...).
  for (const input of [nameInput, codeInput]) {
    for (const type of ["keydown", "keyup", "keypress"]) {
      input.addEventListener(type, (event) => event.stopPropagation());
    }
  }

  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 5);
  });

  const setStatus = (text = "", isError = false) => {
    status.textContent = text;
    status.classList.toggle("mp-error", isError);
  };

  const setBusy = (busy) => {
    createBtn.disabled = busy;
    joinBtn.disabled = busy;
  };

  const rememberName = () => {
    try {
      localStorage.setItem("asylum-mp-name", nameInput.value);
    } catch (error) {
      /* ignora */
    }
  };

  function render() {
    const inRoom = net.active && net.code;
    home.classList.toggle("mp-hidden", !!inRoom);
    room.classList.toggle("mp-hidden", !inRoom);
    if (!inRoom) return;

    codeEl.textContent = net.code;
    listEl.textContent = "";

    for (const player of net.players) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = player.name;
      li.appendChild(name);

      const tags = [];
      if (player.id === "p0") tags.push("host");
      if (player.id === net.myId) tags.push("você");
      if (tags.length) {
        const tag = document.createElement("em");
        tag.textContent = tags.join(" · ");
        li.appendChild(tag);
      }
      listEl.appendChild(li);
    }

    startBtn.classList.toggle("mp-hidden", !net.isHost);
    hintEl.textContent = net.isHost
      ? `${net.players.length}/${MAX_PLAYERS} jogadores. Compartilhe o código e inicie quando todos entrarem.`
      : "Aguardando o host iniciar a partida...";
  }

  function open() {
    root.classList.remove("mp-hidden");
    net.lobbyOpen = true;
    render();
  }

  function close() {
    root.classList.add("mp-hidden");
    net.lobbyOpen = false;
  }

  createBtn.addEventListener("click", async () => {
    rememberName();
    setBusy(true);
    setStatus("Criando sala...");
    try {
      await net.createRoom(nameInput.value);
      setStatus("");
    } catch (error) {
      setStatus(error.message, true);
    }
    setBusy(false);
    render();
  });

  joinBtn.addEventListener("click", async () => {
    rememberName();
    if (codeInput.value.length !== 5) {
      setStatus("O código tem 5 caracteres.", true);
      return;
    }
    setBusy(true);
    setStatus("Conectando...");
    try {
      await net.joinRoom(codeInput.value, nameInput.value);
      setStatus("");
    } catch (error) {
      setStatus(error.message, true);
    }
    setBusy(false);
    render();
  });

  codeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinBtn.click();
  });

  backBtn.addEventListener("click", () => {
    setStatus("");
    close();
  });

  leaveBtn.addEventListener("click", () => {
    net.leave();
    setStatus("");
    render();
  });

  startBtn.addEventListener("click", () => onStart());

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(net.code || "");
      copyBtn.textContent = "COPIADO!";
    } catch (error) {
      copyBtn.textContent = "COPIE À MÃO";
    }
    setTimeout(() => (copyBtn.textContent = "COPIAR"), 1600);
  });

  net.on("lobby", render);
  net.on("closed", () => {
    if (!net.lobbyOpen) return;
    net.leave();
    setStatus("O host encerrou a sala.", true);
    render();
  });
  net.on("error", (message) => {
    if (net.lobbyOpen) setStatus(message, true);
  });

  return { open, close };
}
