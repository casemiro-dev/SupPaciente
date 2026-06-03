/* ==========================================================================
   Teleflow / SupPaciente • v7.0 (Auditoria + correções solicitadas)

   PRINCIPAIS MUDANÇAS vs. v6.3:
   • Senhas e firebaseConfig agora vêm de window.APP_CONFIG (config.local.js,
     que está no .gitignore).
   • Operador pode EDITAR um caso mesmo após o monitor assumi-lo. A edição
     só atualiza título/descrição/direcionamento (NUNCA reverte status ou
     monitorAtendente), então o card permanece visível para ambos.
   • Edição abre em um MODAL próprio (modal-editar-caso), não na aba de
     criação de caso.
   • Qualquer monitor pode finalizar um caso "Em Verificação", mesmo que
     outro monitor o tenha assumido (evita travar a fila se o monitor
     original saiu).
   • Card fechado: descrição volta a fluir em linha corrida (estilo antigo),
     com 3 linhas via line-clamp. Modal aberto continua exibindo quebras.
   • CONSUMO DE BANCO: deixou de baixar a árvore inteira a cada mudança.
     Agora usa listeners por coleção + onChildAdded/Changed/Removed para
     'casos' (a maior coleção), com limitToLast(300). Render é debounced.
   • Removido código morto: sincronizarStorage, caso-id-edicao, helpers
     não usados.
   ========================================================================== */

"use strict";
console.log("Teleflow v7.0 • Correções aplicadas (edição+conclusão+layout+economia banco)");

// --------------------------------------------------------------------------
// HELPERS DE SEGURANÇA (anti-XSS)
// --------------------------------------------------------------------------
function escapeHtml(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function nl2br(v)        { return escapeHtml(v).replace(/\n/g, "<br>"); }
function inlineTexto(v)  { return escapeHtml(v).replace(/\s+/g, " ").trim(); }
window.escapeHtml = escapeHtml;

// --------------------------------------------------------------------------
// CONFIG (vem de config.local.js / .gitignore)
// --------------------------------------------------------------------------
const CFG = (window.APP_CONFIG) || {};
const ADMIN_PASSWORD       = CFG.ADMIN_PASSWORD   ?? "";
const MONITOR_PASSWORD     = CFG.MONITOR_PASSWORD ?? null;
const HEARTBEAT_INTERVALO  = 25_000;
const HEARTBEAT_EXPIRACAO  = 75_000;
const CHAVE_NOTIF_LIDAS    = "teleflow_notif_dismissed";
const CASOS_LIMITE         = 300; // máximo de casos baixados (mais recentes)

// --------------------------------------------------------------------------
// ESTADO
// --------------------------------------------------------------------------
const localDB = { casos: {}, alertas_pa: [], monitores_online: [], notificacoes: [] };
const controleTamanhoAntigo = { alertas: 0, notif: 0 };
let arquivoAberto = false;
let idCasoModalAberto = null;
let heartbeatTimer = null;

// Proteção: só permite escrita após o primeiro snapshot de cada coleção crítica.
let firebaseCarregado = false;
const filaPosCarga = [];

let operadorSessao = JSON.parse(sessionStorage.getItem("teleflow_op_session"))    || null;
let monitorSessao  = JSON.parse(sessionStorage.getItem("teleflow_mon_session"))   || null;
let adminSessao    = JSON.parse(sessionStorage.getItem("teleflow_admin_session")) || null;

// --------------------------------------------------------------------------
// RENDER COM DEBOUNCE (evita thrashing em rajadas do Firebase)
// --------------------------------------------------------------------------
let renderTimer = null;
function agendarRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    window.renderizarTudo();
    if (idCasoModalAberto) window.atualizarApenasTempoEStatusModal();
  }, 80);
}

// --------------------------------------------------------------------------
// SINCRONISMO FIREBASE — OTIMIZADO (per-collection + child events em 'casos')
// --------------------------------------------------------------------------
// ANTES: 1 listener onValue na RAIZ → cada mudança baixava a árvore inteira.
//        Era a causa principal dos 3+ GB/dia de download.
// AGORA: cada coleção tem seu listener. 'casos' usa child events + limit:
//        - download inicial = só os N casos mais recentes
//        - cada update subsequente = só o caso alterado (não a árvore toda)
// --------------------------------------------------------------------------
window.inicializarSincronismoFirebase = function () {
  if (!window.fbDB) return;

  // ---------- CASOS: listeners por filho + limite ----------
  const casosRef = window.fbQuery(
    window.fbRef(window.fbDB, "teleflow_sandbox/casos"),
    window.fbOrderByChild("timestamp"),
    window.fbLimitToLast(CASOS_LIMITE)
  );

  window.fbOnChildAdded(casosRef, (snap) => {
    const c = snap.val(); if (!c || !c.id) return;
    localDB.casos[c.id] = c;
    agendarRender();
  });
  window.fbOnChildChanged(casosRef, (snap) => {
    const c = snap.val(); if (!c || !c.id) return;
    localDB.casos[c.id] = c;
    agendarRender();
  });
  window.fbOnChildRemoved(casosRef, (snap) => {
    const id = snap.key || (snap.val() && snap.val().id);
    if (id) delete localDB.casos[id];
    agendarRender();
  });

  // ---------- COLEÇÕES PEQUENAS: onValue normal ----------
  window.fbOnValue(window.fbRef(window.fbDB, "teleflow_sandbox/alertas_pa"), (snap) => {
    const v = snap.val();
    localDB.alertas_pa = v ? Object.values(v) : [];
    localDB.alertas_pa.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (localDB.alertas_pa.length > controleTamanhoAntigo.alertas && monitorSessao) {
      const ultimo = localDB.alertas_pa[0];
      if (ultimo && ultimo.status === "Aguardando") {
        window.lancarNotificacaoVisualMonitor(
          `ALERTA CRÍTICO: PA ${ultimo.pa} (${ultimo.operador}) solicita suporte presencial!`
        );
      }
    }
    controleTamanhoAntigo.alertas = localDB.alertas_pa.length;
    agendarRender();
  });

  window.fbOnValue(window.fbRef(window.fbDB, "teleflow_sandbox/monitores_online"), (snap) => {
    const v = snap.val();
    localDB.monitores_online = v ? Object.values(v) : [];
    agendarRender();
  });

  window.fbOnValue(window.fbRef(window.fbDB, "teleflow_sandbox/notificacoes"), (snap) => {
    const v = snap.val();
    localDB.notificacoes = v ? Object.values(v) : [];
    if (operadorSessao && localDB.notificacoes.length > controleTamanhoAntigo.notif && controleTamanhoAntigo.notif > 0) {
      const ultima = [...localDB.notificacoes].sort((a,b) => b.timestamp - a.timestamp)[0];
      if (ultima) window.lancarToast(`📢 Novo comunicado: ${ultima.titulo || ultima.mensagem}`, ultima.tipo || "info");
    }
    controleTamanhoAntigo.notif = localDB.notificacoes.length;

    if (!firebaseCarregado) {
      firebaseCarregado = true;
      while (filaPosCarga.length) {
        try { filaPosCarga.shift()(); } catch (e) { console.error(e); }
      }
    }
    agendarRender();
  });

  // Marca carregado em até 4s mesmo se 'notificacoes' estiver vazio
  setTimeout(() => {
    if (!firebaseCarregado) {
      firebaseCarregado = true;
      while (filaPosCarga.length) {
        try { filaPosCarga.shift()(); } catch (e) { console.error(e); }
      }
      agendarRender();
    }
  }, 4_000);

  // Timeout duro de 10s para feedback visual
  setTimeout(() => {
    if (!firebaseCarregado) {
      console.error("[Sincronismo] Firebase não respondeu em 10s.");
      window.lancarToast("Sem conexão com o servidor. Verifique sua internet e recarregue a página (F5).", "danger");
    }
  }, 10_000);
};

// --------------------------------------------------------------------------
// ESCRITAS GRANULARES
// --------------------------------------------------------------------------
function _podeEscrever() {
  if (!window.fbDB) return false;
  if (!firebaseCarregado) {
    console.warn("[Sincronismo] Escrita ignorada: Firebase ainda não carregou.");
    return false;
  }
  return true;
}

window.salvarItem = function (secao, item) {
  if (!_podeEscrever() || !item || !item.id) return;
  try {
    window.fbSet(window.fbRef(window.fbDB, `teleflow_sandbox/${secao}/${item.id}`), item);
  } catch (e) { console.error("[salvarItem]", secao, e); }
};

window.removerItem = function (secao, id) {
  if (!_podeEscrever() || !id) return;
  try {
    window.fbRemove(window.fbRef(window.fbDB, `teleflow_sandbox/${secao}/${id}`));
  } catch (e) { console.error("[removerItem]", secao, id, e); }
};

window.removerVarios = function (secao, ids) {
  if (!_podeEscrever() || !ids || !ids.length) return;
  try {
    const updates = {};
    ids.forEach(id => { updates[`teleflow_sandbox/${secao}/${id}`] = null; });
    window.fbUpdate(window.fbRef(window.fbDB, "/"), updates);
  } catch (e) { console.error("[removerVarios]", secao, e); }
};

window.atualizarCampos = function (secao, id, campos) {
  if (!_podeEscrever() || !id || !campos) return;
  try {
    const updates = {};
    Object.keys(campos).forEach(k => {
      updates[`teleflow_sandbox/${secao}/${id}/${k}`] = campos[k];
    });
    window.fbUpdate(window.fbRef(window.fbDB, "/"), updates);
  } catch (e) { console.error("[atualizarCampos]", secao, id, e); }
};

function aposFirebaseCarregar(fn) {
  if (firebaseCarregado) fn();
  else filaPosCarga.push(fn);
}

// --------------------------------------------------------------------------
// HELPER: lista ordenada de casos a partir do dicionário interno
// --------------------------------------------------------------------------
function listaCasos() {
  return Object.values(localDB.casos)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}
function buscarCaso(id) { return localDB.casos[id] || null; }

// --------------------------------------------------------------------------
// NAVEGAÇÃO / HELPERS
// --------------------------------------------------------------------------
window.irPara = function (telaId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(telaId)?.classList.add("active");
};

window.toggleTheme = function () {
  const body = document.body;
  const novo = body.getAttribute("data-theme") === "dark" ? "light" : "dark";
  body.setAttribute("data-theme", novo);
  const icon = document.getElementById("theme-icon");
  const text = document.getElementById("theme-text");
  if (icon) icon.className = novo === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
  if (text) text.innerText = novo === "dark" ? "Modo Claro" : "Modo Escuro";
};

window.lancarToast = function (mensagem, tipo = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const icones = {
    info:    '<i class="fa-solid fa-circle-info"></i>',
    success: '<i class="fa-solid fa-circle-check"></i>',
    danger:  '<i class="fa-solid fa-triangle-exclamation"></i>',
    warning: '<i class="fa-solid fa-triangle-exclamation"></i>',
  };
  const toast = document.createElement("div");
  toast.className = `toast ${tipo}`;
  toast.innerHTML = `${icones[tipo] || icones.info} <span>${escapeHtml(mensagem)}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 300); }, 4500);
};

window.lancarNotificacaoVisualMonitor = function (texto) {
  window.lancarToast(texto, "danger");
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("🚨 Suporte presencial • Teleflow", { body: texto });
  }
};

window.toggleArquivoRetratil = function () {
  const container = document.getElementById("container-arquivo-retratil");
  const seta = document.getElementById("archive-arrow");
  if (!container || !seta) return;
  arquivoAberto = !arquivoAberto;
  container.classList.toggle("open", arquivoAberto);
  seta.className = arquivoAberto ? "fa-solid fa-chevron-up" : "fa-solid fa-chevron-down";
};

// --------------------------------------------------------------------------
// ROTEIROS
// --------------------------------------------------------------------------
const ROTEIROS = {
  erroAgendamento: { t: "Erro de Agendamento", d: `ADM: \nCaso: \nOS: \nSA-\nCidade: \nTerritório: \nMotivo: \nErro: Não foi possível realizar o agendamento nesse momento. Mas não se preocupe, estamos buscando o melhor horário para encaixe e o cliente será informado.\nDisponibilidade: o dia todo` },
  desbloqueio:     { t: "Desbloqueio", d: `Caso:\nCPF:` },
  telefonia:       { t: "Problema com Telefonia", d: `Caso:\nTelefonia Móvel ou Fixa: \nCPF do cliente:\nNome do Completo do Cliente:\nADM do cliente:\nNúmero da linha:\nProblema relatado:\nProcedimentos realizados:` },
  cancelamento:    { t: "Cancelamento não efetuado", d: `Caso atual da NCC: (seu caso)\nCPF: \nADM: \n\nCaso retenção: (caso gerado pela retenção)\n\nCliente em contato com a Retenção foi informado sobre o cancelamento, mas o plano continuou ativo.\n\n(Data do atendimento com a retenção)\nProtocolo Chat: (protocolo do chat do atendimento com a retenção)\n(colocar o nome do operador da retenção que atendeu)` },
  transferencia:   { t: "Autorização de Transferência", d: `Monitor que autorizou:\nCaso:\nSetor a ser transferido: \nMotivo do cancelamento ou da transferência para outro setor:\nOfertado:` },
  fatura:          { t: "Correção de Fatura", d: `Descrição\nCaso:\nCPF:\nContrato ADM:\nMotivo:` },
  desconto:        { t: "Desconto autorizado", d: `Descrição\nMonitor que autorizou:\n\nADM: \nValor do desconto: \nTempo do desconto: \nTotal do desconto: \nMotivo:\n\nCaso:\nCPF:` },
};

window.aplicarScript = function (tipo) {
  const titulo = document.getElementById("caso-titulo");
  const desc = document.getElementById("caso-descricao");
  const r = ROTEIROS[tipo];
  if (!titulo || !desc || !r) return;
  titulo.value = r.t;
  desc.value = r.d;
  window.lancarToast("Roteiro rápido inserido no formulário.", "info");
};

// --------------------------------------------------------------------------
// MULTI-SESSÃO DO MONITOR + HEARTBEAT
// --------------------------------------------------------------------------
function getMonitoresAtivosUnicos() {
  const agora = Date.now();
  const ativos = localDB.monitores_online.filter(m =>
    !m.lastSeen || (agora - m.lastSeen) < HEARTBEAT_EXPIRACAO
  );
  const porNome = new Map();
  ativos.forEach(m => {
    const atual = porNome.get(m.nome);
    if (!atual) porNome.set(m.nome, { nome: m.nome, status: m.status || "Disponível", sessoes: 1 });
    else {
      atual.sessoes++;
      if (m.status === "Disponível") atual.status = "Disponível";
    }
  });
  return Array.from(porNome.values());
}

function dispararHeartbeat() {
  if (!monitorSessao) return;
  aposFirebaseCarregar(() => {
    const registro = {
      id: monitorSessao.id,
      sessionId: monitorSessao.sessionId,
      nome: monitorSessao.nome,
      status: monitorSessao.status,
      lastSeen: Date.now(),
    };
    window.salvarItem("monitores_online", registro);
  });
}

function iniciarHeartbeat() {
  pararHeartbeat();
  dispararHeartbeat();
  heartbeatTimer = setInterval(dispararHeartbeat, HEARTBEAT_INTERVALO);
}

function pararHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

// Limpa sessões fantasmas (apenas elas — nunca casos)
setInterval(() => {
  if (!firebaseCarregado) return;
  const agora = Date.now();
  const fantasmas = localDB.monitores_online.filter(m =>
    m.lastSeen && (agora - m.lastSeen) >= HEARTBEAT_EXPIRACAO
  );
  if (fantasmas.length) {
    const ids = fantasmas.map(m => m.id);
    window.removerVarios("monitores_online", ids);
  }
}, 30_000);

window.addEventListener("beforeunload", () => {
  if (!monitorSessao || !window.fbDB) return;
  try {
    window.fbRemove(window.fbRef(window.fbDB, `teleflow_sandbox/monitores_online/${monitorSessao.id}`));
  } catch (e) {}
});

// --------------------------------------------------------------------------
// FLUXOS DO OPERADOR
// --------------------------------------------------------------------------
window.iniciarSessaoOperadorMock = function () {
  const nome = document.getElementById("op-nome")?.value.trim();
  const pa   = document.getElementById("op-pa")?.value.trim();
  if (!nome || !pa) { window.lancarToast("Preencha seu nome e o número da PA.", "danger"); return; }

  operadorSessao = { nome, pa: parseInt(pa, 10) };
  sessionStorage.setItem("teleflow_op_session", JSON.stringify(operadorSessao));

  document.getElementById("txt-op-nome").innerText = nome;
  document.getElementById("txt-op-pa").innerText   = `PA ${pa}`;
  document.getElementById("form-identificacao").style.display = "none";
  document.getElementById("area-operador").style.display      = "block";

  window.lancarToast(`Bem-vindo, ${nome}! Conectado à fila.`, "success");
  window.renderizarTudo();
};

window.limparSessaoESairMock = function () {
  sessionStorage.removeItem("teleflow_op_session");
  operadorSessao = null;
  document.getElementById("form-identificacao").style.display = "block";
  document.getElementById("area-operador").style.display      = "none";
  const nome = document.getElementById("op-nome"); if (nome) nome.value = "";
  const pa = document.getElementById("op-pa"); if (pa) pa.value = "";
  window.irPara("tela-login");
};

// SEMPRE cria caso novo. Edição agora é via modal-editar-caso.
window.enviarCasoMock = function () {
  if (!operadorSessao) return;
  const inputTitulo = document.getElementById("caso-titulo");
  const inputDesc = document.getElementById("caso-descricao");
  const selectMonitor = document.getElementById("caso-monitor-direcionado");

  const titulo = inputTitulo?.value.trim();
  const descricao = inputDesc?.value.trim();
  const monitorDirecionado = selectMonitor?.value || "";

  if (!titulo || !descricao) { window.lancarToast("Preencha o título e a descrição do caso.", "danger"); return; }

  const caso = {
    id: "C-" + Date.now() + "-" + Math.floor(1000 + Math.random() * 9000),
    operador: operadorSessao.nome,
    pa: operadorSessao.pa,
    titulo, descricao, monitorDirecionado,
    status: "Pendente",
    timestamp: Date.now(),
    monitorAtendente: "",
    respostaFeedback: "",
  };
  localDB.casos[caso.id] = caso;
  window.salvarItem("casos", caso);
  window.lancarToast("Caso enviado para triagem.", "success");

  if (inputTitulo) inputTitulo.value = "";
  if (inputDesc) inputDesc.value = "";
  if (selectMonitor) selectMonitor.value = "";
};

/* --------------------------------------------------------------------------
   EDIÇÃO DO CASO (operador) — agora em modal próprio.
   Permitida em Pendente E em "Em Verificação" (atualiza só título/desc/
   direcionamento; nunca toca status nem monitorAtendente). Apenas
   "Concluído" não pode ser editado.
   -------------------------------------------------------------------------- */
window.editarCasoOperadorMock = function (id) {
  const caso = buscarCaso(id);
  if (!caso) { window.lancarToast("Caso não encontrado.", "danger"); return; }
  if (caso.status === "Concluído") {
    window.lancarToast("Este chamado já foi concluído e não pode ser editado.", "warning");
    return;
  }

  document.getElementById("editar-caso-id").value = caso.id;
  document.getElementById("editar-caso-titulo").value = caso.titulo || "";
  document.getElementById("editar-caso-descricao").value = caso.descricao || "";
  document.getElementById("editar-caso-monitor").value = caso.monitorDirecionado || "";

  const aviso = document.getElementById("editar-caso-aviso");
  if (caso.status === "Em Verificação") {
    aviso.style.display = "block";
    aviso.innerHTML = `<i class="fa-solid fa-circle-info"></i> Este caso já foi assumido por <strong>${escapeHtml(caso.monitorAtendente || "um monitor")}</strong>. Suas alterações serão atualizadas para o monitor sem retirar o caso da tratativa.`;
  } else {
    aviso.style.display = "none";
    aviso.innerHTML = "";
  }

  document.getElementById("modal-editar-caso").classList.add("open");
};

window.fecharModalEdicaoCaso = function () {
  document.getElementById("modal-editar-caso")?.classList.remove("open");
};

window.salvarEdicaoCaso = function () {
  const id = document.getElementById("editar-caso-id").value;
  if (!id) return;
  const caso = buscarCaso(id);
  if (!caso) { window.lancarToast("Caso não está mais disponível.", "warning"); window.fecharModalEdicaoCaso(); return; }
  if (caso.status === "Concluído") {
    window.lancarToast("Este chamado já foi concluído.", "warning");
    window.fecharModalEdicaoCaso();
    return;
  }

  const titulo = document.getElementById("editar-caso-titulo").value.trim();
  const descricao = document.getElementById("editar-caso-descricao").value.trim();
  const monitorDirecionado = document.getElementById("editar-caso-monitor").value || "";

  if (!titulo || !descricao) { window.lancarToast("Preencha o título e a descrição.", "danger"); return; }

  // Escrita por campo: status e monitorAtendente NUNCA são tocados,
  // por isso o caso continua na fila do monitor que assumiu.
  Object.assign(caso, { titulo, descricao, monitorDirecionado });
  window.atualizarCampos("casos", id, { titulo, descricao, monitorDirecionado });
  window.lancarToast("Chamado atualizado com sucesso.", "success");
  window.fecharModalEdicaoCaso();
};

window.cancelarCasoOperadorMock = function (id) {
  const caso = buscarCaso(id);
  if (!caso) return;
  if (caso.status !== "Pendente") { window.lancarToast("Não é possível cancelar um chamado em andamento.", "danger"); return; }
  if (!confirm("Deseja realmente cancelar e excluir este chamado?")) return;
  const atual = buscarCaso(id);
  if (!atual) { window.lancarToast("Chamado não está mais disponível.", "warning"); return; }
  if (atual.status !== "Pendente") {
    window.lancarToast(`Não foi possível cancelar: o chamado agora está "${atual.status}".`, "warning");
    return;
  }
  delete localDB.casos[id];
  window.removerItem("casos", id);
  window.lancarToast("Chamado removido da fila.", "info");
};

window.chamarMonitorMock = function () {
  if (!operadorSessao) return;
  if (localDB.alertas_pa.some((a) => a.pa === operadorSessao.pa && a.status === "Aguardando")) {
    window.lancarToast("Você já possui uma solicitação ativa.", "danger"); return;
  }
  const alerta = {
    id: "A-" + Date.now() + "-" + Math.floor(1000 + Math.random() * 9000),
    pa: operadorSessao.pa, operador: operadorSessao.nome,
    status: "Aguardando", timestamp: Date.now(),
  };
  localDB.alertas_pa.push(alerta);
  window.salvarItem("alertas_pa", alerta);
  window.lancarToast("Alerta emitido. Aguarde o monitor na sua PA.", "success");
};

window.cancelarAlertaPresencialOperadorMock = function (id) {
  localDB.alertas_pa = localDB.alertas_pa.filter((a) => a.id !== id);
  window.removerItem("alertas_pa", id);
  window.lancarToast("Solicitação cancelada.", "info");
};

window.dispensarComunicado = function (id) {
  const lidas = JSON.parse(localStorage.getItem(CHAVE_NOTIF_LIDAS) || "[]");
  if (!lidas.includes(id)) lidas.push(id);
  localStorage.setItem(CHAVE_NOTIF_LIDAS, JSON.stringify(lidas));
  window.renderizarSino();
  window.renderizarModalNotificacoes();
};

// --------------------------------------------------------------------------
// SINO DE NOTIFICAÇÕES (OPERADOR)
// --------------------------------------------------------------------------
let notifExpandidaId = null;

function notificacoesAtivasParaOperador() {
  const lidas = JSON.parse(localStorage.getItem(CHAVE_NOTIF_LIDAS) || "[]");
  return [...localDB.notificacoes]
    .filter(n => !lidas.includes(n.id))
    .sort((a, b) => b.timestamp - a.timestamp);
}

window.renderizarSino = function () {
  if (!operadorSessao) return;
  const ativas = notificacoesAtivasParaOperador();
  const badge = document.getElementById("bell-badge");
  if (!badge) return;
  if (ativas.length > 0) {
    badge.style.display = "flex";
    badge.innerText = ativas.length > 99 ? "99+" : String(ativas.length);
  } else {
    badge.style.display = "none";
  }
};

window.abrirModalNotificacoes = function () {
  notifExpandidaId = null;
  window.renderizarModalNotificacoes();
  document.getElementById("modal-notif-operador")?.classList.add("open");
};

window.fecharModalNotificacoes = function () {
  document.getElementById("modal-notif-operador")?.classList.remove("open");
  notifExpandidaId = null;
};

window.expandirNotificacao = function (id) {
  notifExpandidaId = notifExpandidaId === id ? null : id;
  window.renderizarModalNotificacoes();
};

window.renderizarModalNotificacoes = function () {
  const cont = document.getElementById("notif-modal-lista");
  if (!cont) return;
  const ativas = notificacoesAtivasParaOperador();
  if (ativas.length === 0) {
    cont.innerHTML = `<div class="notif-modal-empty">
      <i class="fa-solid fa-bell-slash"></i>
      <p>Nenhum comunicado no momento.</p>
    </div>`;
    return;
  }
  cont.innerHTML = ativas.map(n => {
    const expandida = notifExpandidaId === n.id;
    const tipo = (n.tipo || "info").replace(/[^a-z]/gi, "");
    const titulo = n.titulo || "Comunicado";
    return `
      <div class="notif-item ${tipo} ${expandida ? 'expandida' : ''}" onclick="expandirNotificacao('${escapeHtml(n.id)}')">
        <div class="notif-item-header">
          <div class="notif-item-title">
            <span class="notif-pill notif-pill-${tipo}">${tipo.toUpperCase()}</span>
            <strong>${escapeHtml(titulo)}</strong>
          </div>
          <div class="notif-item-meta">
            <span class="notif-time">${new Date(n.timestamp).toLocaleString("pt-BR")}</span>
            <button class="notif-dismiss" onclick="event.stopPropagation(); dispensarComunicado('${escapeHtml(n.id)}')" title="Marcar como lido para mim">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>
        <div class="notif-item-body">
          ${expandida
            ? `<div class="notif-item-full">${nl2br(n.mensagem)}</div>`
            : `<div class="notif-item-preview">${nl2br(n.mensagem)}</div>`}
        </div>
        ${!expandida ? `<div class="notif-item-hint">Toque para expandir</div>` : ''}
      </div>`;
  }).join("");
};

// --------------------------------------------------------------------------
// FLUXOS DO MONITOR
// --------------------------------------------------------------------------
function gerarSessionId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

window.loginMonitorMock = function () {
  const nome  = document.getElementById("monitor-nome-login")?.value;
  const senha = document.getElementById("monitor-senha-login")?.value;
  if (!nome || !senha) { window.lancarToast("Selecione seu nome e insira a credencial.", "danger"); return; }
  if (MONITOR_PASSWORD && senha !== MONITOR_PASSWORD) { window.lancarToast("Senha incorreta.", "danger"); return; }

  const sessionId = gerarSessionId();
  monitorSessao = {
    id: "M-" + nome.toLowerCase() + "-" + sessionId,
    sessionId, nome, status: "Disponível",
  };
  sessionStorage.setItem("teleflow_mon_session", JSON.stringify(monitorSessao));

  aposFirebaseCarregar(() => {
    window.salvarItem("monitores_online", {
      id: monitorSessao.id, sessionId, nome, status: "Disponível", lastSeen: Date.now(),
    });
  });

  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();

  document.getElementById("txt-nome-monitor-logado").innerHTML =
    `<i class="fa-solid fa-user-shield"></i> Monitor conectado: <strong>${escapeHtml(nome)}</strong>`;
  document.getElementById("monitor-senha-login").value = "";
  document.getElementById("monitor-nome-login").value = "";

  window.irPara("tela-monitor");
  window.lancarToast(`Console inicializado para ${nome}.`, "success");
  iniciarHeartbeat();
};

window.deslogarMonitorMock = function () {
  if (monitorSessao) {
    const idSair = monitorSessao.id;
    window.removerItem("monitores_online", idSair);
  }
  pararHeartbeat();
  sessionStorage.removeItem("teleflow_mon_session");
  monitorSessao = null;
  window.irPara("tela-login");
};

window.alterarStatusMonitorMock = function (novoStatus) {
  if (!monitorSessao) return;
  monitorSessao.status = novoStatus;
  sessionStorage.setItem("teleflow_mon_session", JSON.stringify(monitorSessao));
  const registro = {
    id: monitorSessao.id, sessionId: monitorSessao.sessionId,
    nome: monitorSessao.nome, status: novoStatus, lastSeen: Date.now(),
  };
  const optDisp = document.getElementById("status-opt-disp");
  const optNp = document.getElementById("status-opt-np");
  if (optDisp) optDisp.className = novoStatus === "Disponível" ? "status-opt active-disp" : "status-opt";
  if (optNp)   optNp.className   = novoStatus === "Não Perturbe" ? "status-opt active-np" : "status-opt";
  window.lancarToast(`Status alterado: ${novoStatus === "Disponível" ? "Disponível" : "Indisponível"}`, "info");
  window.salvarItem("monitores_online", registro);
};

window.atenderCasoMonitorMock = function (id) {
  if (!monitorSessao) return;
  const caso = buscarCaso(id);
  if (!caso) return;
  if (caso.status === "Concluído") {
    window.lancarToast("Este chamado já foi concluído.", "warning"); return;
  }
  if (caso.status === "Em Verificação") {
    // Mesmo que outro monitor tenha assumido, abrimos o modal para que
    // qualquer monitor possa visualizar e (se necessário) concluir.
    window.abrirModalCaso(id);
    return;
  }
  caso.status = "Em Verificação";
  caso.monitorAtendente = monitorSessao.nome;
  window.atualizarCampos("casos", id, {
    status: "Em Verificação",
    monitorAtendente: monitorSessao.nome,
  });
  window.lancarToast(`Você assumiu a tratativa do chamado ${id}.`, "success");
  window.abrirModalCaso(id);
};

/*
 * concluirCasoMonitorMock
 * Qualquer monitor logado pode finalizar, mesmo que outro monitor tenha
 * assumido (cenário: Monitor A foi embora deixando aberto, Monitor B fecha).
 * Registramos quem efetivamente concluiu em monitorAtendente para que o
 * relatório/visualização reflita a realidade.
 */
window.concluirCasoMonitorMock = function (id, feedbackTexto) {
  const caso = buscarCaso(id);
  if (!caso) return;
  if (!monitorSessao) { window.lancarToast("Faça login como monitor para concluir.", "danger"); return; }
  if (caso.status === "Concluído") { window.lancarToast("Caso já está concluído.", "warning"); return; }

  const resposta = feedbackTexto || "Atendimento avaliado e concluído pela supervisão.";
  const concluidoEm = Date.now();
  const quemConclui = monitorSessao.nome;

  caso.status = "Concluído";
  caso.respostaFeedback = resposta;
  caso.concluidoEm = concluidoEm;
  caso.monitorAtendente = quemConclui; // quem finalizou de fato

  window.atualizarCampos("casos", id, {
    status: "Concluído",
    respostaFeedback: resposta,
    concluidoEm: concluidoEm,
    monitorAtendente: quemConclui,
  });
  window.lancarToast(`Chamado ${id} solucionado.`, "success");
};

window.atenderAlertaPresencialMock = function (id) {
  if (!monitorSessao) return;
  const alerta = localDB.alertas_pa.find((a) => a.id === id);
  if (!alerta) return;
  alerta.status = "Em Atendimento";
  alerta.monitorAtendente = monitorSessao.nome;
  window.atualizarCampos("alertas_pa", id, {
    status: "Em Atendimento",
    monitorAtendente: monitorSessao.nome,
  });
  window.lancarToast(`Deslocamento registrado para a PA ${alerta.pa}.`, "info");
};

window.concluirAlertaPresencialMock = function (id) {
  localDB.alertas_pa = localDB.alertas_pa.filter((a) => a.id !== id);
  window.removerItem("alertas_pa", id);
  window.lancarToast("Suporte presencial concluído.", "success");
};

// --------------------------------------------------------------------------
// FLUXOS DO ADMIN
// --------------------------------------------------------------------------
window.loginAdminMock = function () {
  const senha = document.getElementById("admin-senha-login")?.value;
  if (!senha) { window.lancarToast("Insira a senha administrativa.", "danger"); return; }
  if (!ADMIN_PASSWORD) {
    window.lancarToast("ADMIN_PASSWORD não configurado em config.local.js.", "danger"); return;
  }
  if (senha !== ADMIN_PASSWORD) { window.lancarToast("Senha incorreta.", "danger"); return; }

  adminSessao = { logadoEm: Date.now() };
  sessionStorage.setItem("teleflow_admin_session", JSON.stringify(adminSessao));
  document.getElementById("admin-senha-login").value = "";
  window.irPara("tela-admin");
  window.lancarToast("Painel administrativo desbloqueado.", "success");
  window.trocarAbaAdmin("relatorios");
};

window.deslogarAdminMock = function () {
  sessionStorage.removeItem("teleflow_admin_session");
  adminSessao = null;
  window.irPara("tela-login");
};

window.trocarAbaAdmin = function (aba) {
  document.querySelectorAll(".admin-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === aba));
  document.querySelectorAll(".admin-tab-content").forEach(c => c.classList.remove("active"));
  document.getElementById(`admin-aba-${aba}`)?.classList.add("active");
  window.renderizarTudo();
};

window.forcarLogoutMonitorAdmin = function (monitorId, monitorNome) {
  if (!confirm(`Forçar desconexão desta sessão de ${monitorNome}?`)) return;
  window.removerItem("monitores_online", monitorId);
  window.lancarToast(`Sessão de ${monitorNome} desconectada.`, "info");
};

window.enviarNotificacaoAdminMock = function () {
  const tipo  = document.getElementById("admin-notif-tipo")?.value || "info";
  const titulo = document.getElementById("admin-notif-titulo")?.value.trim() || "Comunicado";
  const msg   = document.getElementById("admin-notif-msg")?.value.trim();
  if (!msg) { window.lancarToast("Escreva uma mensagem.", "danger"); return; }
  if (msg.length > 600) { window.lancarToast("Mensagem muito longa (máx. 600).", "danger"); return; }

  const notif = {
    id: "N-" + Date.now() + "-" + Math.floor(1000 + Math.random() * 9000),
    tipo, titulo, mensagem: msg,
    timestamp: Date.now(),
    autor: "Administração",
  };
  localDB.notificacoes.push(notif);
  window.salvarItem("notificacoes", notif);
  document.getElementById("admin-notif-msg").value = "";
  document.getElementById("admin-notif-titulo").value = "";
  window.lancarToast("Comunicado transmitido a todos os operadores.", "success");
};

window.removerNotificacaoAdmin = function (id) {
  if (!confirm("Remover este comunicado para todos os operadores?")) return;
  localDB.notificacoes = localDB.notificacoes.filter(n => n.id !== id);
  window.removerItem("notificacoes", id);
};

// --------------------------------------------------------------------------
// EXPORT JSON + LIMPEZA MANUAL (admin)
// --------------------------------------------------------------------------
function inicioDoDiaTs() { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }

function filtrarCasosPorPeriodo(periodo, base = listaCasos()) {
  const agora = Date.now();
  let limite = 0;
  if (periodo === "hoje")   limite = inicioDoDiaTs();
  if (periodo === "semana") limite = agora - 7  * 24 * 60 * 60 * 1000;
  if (periodo === "mes")    limite = agora - 30 * 24 * 60 * 60 * 1000;
  if (periodo === "tudo")   limite = 0;
  return base.filter(c => (c.timestamp || 0) >= limite);
}

window.exportarRelatorioJSON = function () {
  const periodo = document.getElementById("report-periodo")?.value || "hoje";
  const casos = filtrarCasosPorPeriodo(periodo);
  if (!casos.length) { window.lancarToast("Sem dados no período selecionado.", "warning"); return; }

  const payload = {
    geradoEm: new Date().toISOString(),
    periodo, totalCasos: casos.length,
    casos: casos.map(c => ({
      id: c.id, operador: c.operador, pa: c.pa,
      titulo: c.titulo, descricao: c.descricao,
      monitorDirecionado: c.monitorDirecionado || null,
      monitorAtendente: c.monitorAtendente || null,
      status: c.status, respostaFeedback: c.respostaFeedback || null,
      criadoEm: c.timestamp ? new Date(c.timestamp).toISOString() : null,
      concluidoEm: c.concluidoEm ? new Date(c.concluidoEm).toISOString() : null,
    })),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `suppaciente_casos_${periodo}_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  window.lancarToast(`Download iniciado: ${casos.length} casos.`, "success");
};

window.apagarConcluidosAdmin = function () {
  const periodo = document.getElementById("limpeza-periodo")?.value || "hoje";
  const alvos = filtrarCasosPorPeriodo(periodo).filter(c => c.status === "Concluído");
  if (alvos.length === 0) {
    window.lancarToast("Nenhum caso concluído encontrado nesse período.", "warning");
    return;
  }
  const labelPeriodo = {
    hoje: "concluídos hoje",
    semana: "concluídos nos últimos 7 dias",
    mes: "concluídos nos últimos 30 dias",
    tudo: "TODOS os concluídos do histórico",
  }[periodo];

  const ok = confirm(
    `Apagar ${alvos.length} caso(s) ${labelPeriodo}?\n\n` +
    `Apenas casos com status "Concluído" serão removidos.\n` +
    `Pendentes e em tratativa NÃO serão tocados.\n\n` +
    `Esta ação não pode ser desfeita.`
  );
  if (!ok) return;

  const idsApagar = alvos.map(c => c.id);
  idsApagar.forEach(id => delete localDB.casos[id]);
  window.removerVarios("casos", idsApagar);
  window.lancarToast(`${idsApagar.length} caso(s) concluído(s) apagado(s).`, "success");
  atualizarPreviewLimpeza();
};

function atualizarPreviewLimpeza() {
  const cont = document.getElementById("limpeza-preview");
  if (!cont) return;
  const periodo = document.getElementById("limpeza-periodo")?.value || "hoje";
  const alvos = filtrarCasosPorPeriodo(periodo).filter(c => c.status === "Concluído");
  const pendentesNoPeriodo = filtrarCasosPorPeriodo(periodo).filter(c => c.status !== "Concluído").length;

  cont.innerHTML = `
    <div class="limpeza-preview-grid">
      <div class="limpeza-stat danger">
        <span class="limpeza-stat-label">Serão apagados</span>
        <span class="limpeza-stat-value">${alvos.length}</span>
        <span class="limpeza-stat-sub">casos concluídos</span>
      </div>
      <div class="limpeza-stat safe">
        <span class="limpeza-stat-label">Permanecem intactos</span>
        <span class="limpeza-stat-value">${pendentesNoPeriodo}</span>
        <span class="limpeza-stat-sub">pendentes / em tratativa</span>
      </div>
    </div>`;
}

// --------------------------------------------------------------------------
// MODAL DETALHE DO CASO
// --------------------------------------------------------------------------
window.abrirModalCaso = function (id) {
  const caso = buscarCaso(id);
  if (!caso) return;
  idCasoModalAberto = id;
  const modal = document.getElementById("modal-detalhe-caso");
  if (!modal) return;

  document.getElementById("modal-titulo-caso").innerText = caso.titulo;
  document.getElementById("modal-descricao-caso").innerText = caso.descricao;
  document.getElementById("modal-op-pa").innerHTML =
    `<i class="fa-solid fa-headset"></i> Operador: <strong>${escapeHtml(caso.operador)}</strong> (PA ${escapeHtml(caso.pa)})`;

  const areaTratativa = document.getElementById("modal-area-tratativa");
  const areaResposta = document.getElementById("modal-area-resposta-concluida");
  const inputFeedback = document.getElementById("modal-input-feedback");
  const btnFinalizar = document.getElementById("modal-btn-finalizar");

  // Mostra área de tratativa para QUALQUER monitor logado quando o caso
  // estiver Em Verificação — assim Monitor B pode finalizar caso de A.
  if (caso.status === "Em Verificação" && monitorSessao) {
    areaTratativa.style.display = "block";
    areaResposta.style.display = "none";
    inputFeedback.value = "";
    btnFinalizar.onclick = function () {
      const txt = inputFeedback.value.trim();
      if (!txt) { window.lancarToast("Insira o parecer técnico para encerrar.", "danger"); return; }
      window.concluirCasoMonitorMock(id, txt);
      window.fecharModalCaso();
    };
  } else if (caso.status === "Concluído") {
    areaTratativa.style.display = "none";
    areaResposta.style.display = "block";
    areaResposta.innerHTML =
      `<strong><i class="fa-solid fa-user-shield"></i> Solucionado por ${escapeHtml(caso.monitorAtendente)}:</strong>` +
      `<p style="margin-top:8px;">${nl2br(caso.respostaFeedback)}</p>`;
  } else {
    areaTratativa.style.display = "none";
    areaResposta.style.display = "none";
  }

  window.atualizarApenasTempoEStatusModal();
  modal.classList.add("open");
};

window.fecharModalCaso = function () {
  document.getElementById("modal-detalhe-caso")?.classList.remove("open");
  idCasoModalAberto = null;
};

window.copiarConteudoCasoModal = function () {
  if (!idCasoModalAberto) return;
  const caso = buscarCaso(idCasoModalAberto);
  if (!caso) return;
  const conteudo = `${caso.titulo}\n\n${caso.descricao}`;
  const btn = document.querySelector(".btn-icon-copy");
  const okVisual = () => {
    if (!btn) return;
    const html = btn.innerHTML;
    btn.classList.add("copiado");
    btn.innerHTML = '<i class="fa-solid fa-check"></i>';
    setTimeout(() => { btn.classList.remove("copiado"); btn.innerHTML = html; }, 1600);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(conteudo).then(() => {
      window.lancarToast("Conteúdo copiado para a área de transferência.", "success");
      okVisual();
    }).catch(() => fallbackCopiar(conteudo, okVisual));
  } else {
    fallbackCopiar(conteudo, okVisual);
  }
};

function fallbackCopiar(texto, cb) {
  const ta = document.createElement("textarea");
  ta.value = texto;
  ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); window.lancarToast("Conteúdo copiado.", "success"); cb && cb(); }
  catch (e) { window.lancarToast("Não foi possível copiar.", "danger"); }
  ta.remove();
}

window.atualizarApenasTempoEStatusModal = function () {
  if (!idCasoModalAberto) return;
  const caso = buscarCaso(idCasoModalAberto);
  const el = document.getElementById("modal-timer-status");
  if (!caso || !el) return;
  const minPassados = Math.floor((Date.now() - caso.timestamp) / 60000);
  let badge = "";
  if (caso.status === "Pendente")       badge = `<span class="badge warning">Aguardando (${minPassados}m)</span>`;
  if (caso.status === "Em Verificação") badge = `<span class="badge info">Em tratativa por ${escapeHtml(caso.monitorAtendente)} (${minPassados}m)</span>`;
  if (caso.status === "Concluído")      badge = `<span class="badge success">Solucionado</span>`;
  el.innerHTML = badge;
};

// --------------------------------------------------------------------------
// RENDERIZAÇÃO PRINCIPAL
// --------------------------------------------------------------------------
window.renderizarTudo = function () {
  const min = (t) => Math.floor((Date.now() - t) / 60000);
  const monitoresAtivos = getMonitoresAtivosUnicos();
  const casos = listaCasos();

  // 1. Monitores online (operador)
  const gridMonitores = document.getElementById("grid-monitores-online");
  if (gridMonitores && operadorSessao) {
    if (monitoresAtivos.length === 0) {
      gridMonitores.innerHTML =
        `<div style="grid-column:1/-1; color:var(--text-muted); font-size:0.85rem; font-style:italic;">Nenhum monitor conectado no momento. Suas requisições entram na fila global.</div>`;
    } else {
      gridMonitores.innerHTML = monitoresAtivos.map(m => {
        const indisp = m.status !== "Disponível";
        return `
          <div class="monitor-status-card ${indisp ? 'np' : 'disp'}">
            <strong>${escapeHtml(m.nome)}${indisp ? ' (Indisponível)' : ''}</strong>
            <span>${indisp ? 'Indisponível' : 'Disponível'}</span>
          </div>`;
      }).join("");
    }
  }

  // 2. Sino
  window.renderizarSino();
  if (document.getElementById("modal-notif-operador")?.classList.contains("open")) {
    window.renderizarModalNotificacoes();
  }

  // 3. Alerta presencial / botão
  const boxAlertaOp = document.getElementById("alerta-suporte-operador");
  const btnChamarMon = document.getElementById("btn-chamar-monitor");
  if (operadorSessao) {
    const alerta = localDB.alertas_pa.find((a) => a.pa === operadorSessao.pa);
    if (alerta && boxAlertaOp) {
      boxAlertaOp.style.display = "block";
      boxAlertaOp.className = "emergency-item";
      if (alerta.status === "Aguardando") {
        boxAlertaOp.innerHTML =
          `<div><i class="fa-solid fa-spinner fa-spin" style="color:var(--warning);"></i> <strong>Chamado presencial ativo:</strong> aguardando monitor na PA ${escapeHtml(alerta.pa)}.</div>
           <button class="btn-back" style="margin:0;" onclick="cancelarAlertaPresencialOperadorMock('${escapeHtml(alerta.id)}')">Cancelar</button>`;
      } else {
        boxAlertaOp.style.borderLeftColor = "var(--success)";
        boxAlertaOp.innerHTML =
          `<div><i class="fa-solid fa-user-check" style="color:var(--success);"></i> <strong>Monitor a caminho:</strong> ${escapeHtml(alerta.monitorAtendente)} se deslocando até sua PA.</div>`;
      }
      if (btnChamarMon) btnChamarMon.style.display = "none";
    } else {
      if (boxAlertaOp) boxAlertaOp.style.display = "none";
      if (btnChamarMon) btnChamarMon.style.display = "inline-flex";
    }
  }

  // 4. Chamados do operador
  const listaOp = document.getElementById("lista-casos-operador");
  if (listaOp && operadorSessao) {
    const meus = casos.filter((c) => c.operador === operadorSessao.nome);
    listaOp.innerHTML = "";
    if (meus.length === 0) {
      listaOp.innerHTML = `<div style="grid-column:1/-1; color:var(--text-muted); padding:14px; text-align:center;">Você não realizou transmissões hoje.</div>`;
    } else {
      meus.forEach((c) => {
        const card = document.createElement("div");
        card.className = `case-card ${c.status === "Concluído" ? "card-concluido" : ""}`;
        let badge = "", acoes = "";
        if (c.status === "Pendente") {
          badge = `<span class="badge warning">Aguardando (${min(c.timestamp)}m)</span>`;
          acoes = `<div class="card-actions-row">
            <button class="btn-secondary" onclick="event.stopPropagation(); editarCasoOperadorMock('${escapeHtml(c.id)}')"><i class="fa-solid fa-pen"></i> Editar</button>
            <button class="btn-danger" onclick="event.stopPropagation(); cancelarCasoOperadorMock('${escapeHtml(c.id)}')"><i class="fa-solid fa-trash"></i> Cancelar</button>
          </div>`;
        } else if (c.status === "Em Verificação") {
          badge = `<span class="badge info">Em suporte por ${escapeHtml(c.monitorAtendente)}</span>`;
          // Operador pode editar mesmo em verificação (apenas título/desc/direcionamento).
          acoes = `<div class="card-actions-row">
            <button class="btn-secondary" onclick="event.stopPropagation(); editarCasoOperadorMock('${escapeHtml(c.id)}')"><i class="fa-solid fa-pen"></i> Editar</button>
          </div>`;
        } else {
          badge = `<span class="badge success">Solucionado</span>`;
        }
        const labelDir = c.monitorDirecionado
          ? `<div class="tag-monitor-direcionado"><i class="fa-solid fa-arrow-turn-up"></i> ${escapeHtml(c.monitorDirecionado)}</div>` : "";
        // Preview em linha corrida (sem <br>), igual ao layout antigo (Imagem 1).
        card.innerHTML = `
          <div class="card-top-info"><span>${escapeHtml(c.id)}</span> ${badge}</div>
          <h4>${escapeHtml(c.titulo)}</h4>
          <p class="desc-truncada">${inlineTexto(c.descricao)}</p>
          ${labelDir}${acoes}`;
        card.addEventListener("click", (e) => {
          if (e.target.closest(".card-actions-row")) return;
          window.abrirModalCaso(c.id);
        });
        listaOp.appendChild(card);
      });
    }
  }

  // 5. Emergências (monitor)
  const painelEm = document.getElementById("painel-emergencias");
  const listaEm = document.getElementById("lista-emergencias");
  if (painelEm && listaEm) {
    if (localDB.alertas_pa.length === 0) {
      painelEm.style.display = "none";
    } else {
      painelEm.style.display = "block";
      listaEm.innerHTML = localDB.alertas_pa.map(a =>
        a.status === "Aguardando"
          ? `<div class="emergency-item">
               <div>🚨 <strong>PA ${escapeHtml(a.pa)}</strong> — ${escapeHtml(a.operador)} aguarda suporte (${min(a.timestamp)}m)</div>
               <button onclick="atenderAlertaPresencialMock('${escapeHtml(a.id)}')" class="btn-success"><i class="fa-solid fa-person-walking-arrow-right"></i> Prestar suporte</button>
             </div>`
          : `<div class="emergency-item" style="border-left-color:var(--success);">
               <div><i class="fa-solid fa-check-double" style="color:var(--success);"></i> ${escapeHtml(a.monitorAtendente)} em atendimento na PA ${escapeHtml(a.pa)}.</div>
               <button onclick="concluirAlertaPresencialMock('${escapeHtml(a.id)}')" class="btn-secondary"><i class="fa-solid fa-circle-check"></i> Finalizar</button>
             </div>`
      ).join("");
    }
  }

  // 6. Fila / arquivo (monitor)
  const listaFila = document.getElementById("lista-casos-monitor");
  const listaArq = document.getElementById("lista-casos-concluidos-monitor");
  const countArq = document.getElementById("count-arquivados");
  const statPend = document.getElementById("stat-pendentes");
  const statConcl = document.getElementById("stat-concluidos");

  const termo = document.getElementById("search-input")?.value.toLowerCase() || "";
  const filDir = document.getElementById("filter-direcionamento")?.value || "Todos";
  const filSt = document.getElementById("filter-status")?.value || "Todos";

  if (listaFila && listaArq) {
    listaFila.innerHTML = ""; listaArq.innerHTML = "";
    let totalPend = 0, totalConcl = 0;
    casos.forEach((c) => {
      if (c.status === "Pendente") totalPend++;
      if (c.status === "Concluído") totalConcl++;
      const matchBusca =
        (c.operador || "").toLowerCase().includes(termo) ||
        (c.titulo || "").toLowerCase().includes(termo) ||
        (c.descricao || "").toLowerCase().includes(termo) ||
        String(c.pa || "").includes(termo) ||
        (c.id || "").toLowerCase().includes(termo);
      const matchDir = filDir !== "Meus" || !monitorSessao
        ? true
        : (c.monitorDirecionado === monitorSessao.nome || c.monitorAtendente === monitorSessao.nome);
      const matchSt = filSt === "Todos" ? true : c.status === filSt;
      if (!matchBusca || !matchDir || !matchSt) return;

      const card = document.createElement("div");
      card.className = `case-card ${c.status === "Concluído" ? "card-concluido" : ""}`;
      let badge = "", acao = "";
      if (c.status === "Pendente") {
        badge = `<span class="badge warning">Pendente (${min(c.timestamp)}m)</span>`;
        acao = `<button class="btn-success" onclick="event.stopPropagation(); atenderCasoMonitorMock('${escapeHtml(c.id)}')"><i class="fa-solid fa-handshake-angle"></i> Assumir tratativa</button>`;
      } else if (c.status === "Em Verificação") {
        const souEu = monitorSessao && c.monitorAtendente === monitorSessao.nome;
        badge = `<span class="badge info">${souEu ? "Sob sua análise" : "Com " + escapeHtml(c.monitorAtendente)}</span>`;
        // Qualquer monitor pode abrir e finalizar — botão sempre como "Responder & finalizar".
        acao = monitorSessao
          ? `<button class="btn-secondary" onclick="event.stopPropagation(); abrirModalCaso('${escapeHtml(c.id)}')"><i class="fa-solid fa-folder-open"></i> Responder &amp; finalizar</button>`
          : `<button class="btn-secondary" onclick="event.stopPropagation(); abrirModalCaso('${escapeHtml(c.id)}')"><i class="fa-solid fa-folder-open"></i> Visualizar</button>`;
      } else {
        badge = `<span class="badge success">Solucionado</span>`;
        acao = `<button class="btn-secondary" onclick="event.stopPropagation(); abrirModalCaso('${escapeHtml(c.id)}')"><i class="fa-solid fa-eye"></i> Rever</button>`;
      }
      const labelDir = c.monitorDirecionado
        ? `<div class="tag-monitor-direcionado ${monitorSessao && c.monitorDirecionado === monitorSessao.nome ? "destacado" : ""}"><i class="fa-solid fa-user-tag"></i> ${escapeHtml(c.monitorDirecionado)}</div>` : "";
      card.innerHTML = `
        <div class="card-top-info"><strong>PA ${escapeHtml(c.pa)} • ${escapeHtml(c.operador)}</strong> ${badge}</div>
        <h4>${escapeHtml(c.titulo)}</h4>
        <p class="desc-truncada">${inlineTexto(c.descricao)}</p>
        ${labelDir}${acao}`;
      card.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        window.abrirModalCaso(c.id);
      });
      if (c.status === "Concluído") listaArq.appendChild(card);
      else listaFila.appendChild(card);
    });

    if (statPend) statPend.innerText = totalPend;
    if (statConcl) statConcl.innerText = totalConcl;
    if (countArq) countArq.innerText = listaArq.children.length;
    if (!listaFila.children.length) {
      listaFila.innerHTML = `<div style="grid-column:1/-1; color:var(--text-muted); padding:24px; text-align:center; font-style:italic;">Nenhum chamado ativo na fila atende aos filtros definidos.</div>`;
    }
    if (!listaArq.children.length) {
      listaArq.innerHTML = `<div style="grid-column:1/-1; color:var(--text-muted); padding:16px; text-align:center; font-style:italic;">Nenhum caso solucionado listado aqui.</div>`;
    }
  }

  // 7. Admin
  if (adminSessao && document.getElementById("tela-admin")?.classList.contains("active")) {
    renderizarAdminMonitores();
    renderizarAdminNotificacoes();
    renderizarRelatorios();
    atualizarPreviewLimpeza();
  }
};

// --------------------------------------------------------------------------
// RENDERS DO ADMIN
// --------------------------------------------------------------------------
function renderizarAdminMonitores() {
  const cont = document.getElementById("admin-lista-monitores");
  if (!cont) return;
  const agora = Date.now();
  if (localDB.monitores_online.length === 0) {
    cont.innerHTML = `<div style="grid-column:1/-1; color:var(--text-muted); padding:14px; text-align:center; font-style:italic;">Nenhuma sessão de monitor conectada.</div>`;
    return;
  }
  cont.innerHTML = localDB.monitores_online.map(m => {
    const segundosOff = m.lastSeen ? Math.round((agora - m.lastSeen) / 1000) : null;
    const ativo = !m.lastSeen || (agora - m.lastSeen) < HEARTBEAT_EXPIRACAO;
    const indisp = m.status === "Não Perturbe";
    const badgeStatus = !ativo
      ? `<span class="badge danger">Fantasma (${segundosOff}s sem sinal)</span>`
      : indisp
        ? `<span class="badge danger">Indisponível</span>`
        : `<span class="badge success">Disponível</span>`;
    return `
      <div class="admin-monitor-card">
        <div class="am-top">
          <div><div class="am-name">${escapeHtml(m.nome)}</div>
            <div class="am-meta">Sessão: ${escapeHtml(m.sessionId || m.id)} · Último sinal: ${m.lastSeen ? new Date(m.lastSeen).toLocaleTimeString("pt-BR") : "—"}</div>
          </div>
          ${badgeStatus}
        </div>
        <div class="am-actions">
          <button class="btn-danger" data-monitor-id="${escapeHtml(m.id)}" data-monitor-nome="${escapeHtml(m.nome)}" onclick="forcarLogoutMonitorAdmin(this.dataset.monitorId, this.dataset.monitorNome)">
            <i class="fa-solid fa-power-off"></i> Forçar desconexão desta sessão
          </button>
        </div>
      </div>`;
  }).join("");
}

function renderizarAdminNotificacoes() {
  const cont = document.getElementById("admin-lista-notificacoes");
  if (!cont) return;
  const ordenadas = [...localDB.notificacoes].sort((a,b) => b.timestamp - a.timestamp);
  if (ordenadas.length === 0) {
    cont.innerHTML = `<div style="color:var(--text-muted); padding:10px; text-align:center; font-style:italic;">Nenhum comunicado ativo.</div>`;
    return;
  }
  cont.innerHTML = ordenadas.map(n => {
    const tipo = (n.tipo || "info").replace(/[^a-z]/gi, "");
    return `
    <div class="notif-history-item ${tipo}">
      <div>
        <strong>${tipo.toUpperCase()}${n.titulo ? ' · ' + escapeHtml(n.titulo) : ''}:</strong> ${nl2br(n.mensagem)}
        <div class="nh-time">${new Date(n.timestamp).toLocaleString("pt-BR")}</div>
      </div>
      <button onclick="removerNotificacaoAdmin('${escapeHtml(n.id)}')"><i class="fa-solid fa-trash"></i> Remover</button>
    </div>`;
  }).join("");
}

window.renderizarRelatorios = function () {
  const periodo = document.getElementById("report-periodo")?.value || "semana";
  const casos = filtrarCasosPorPeriodo(periodo);

  const total = casos.length;
  const concl = casos.filter(c => c.status === "Concluído").length;
  const pend  = casos.filter(c => c.status === "Pendente").length;
  const emVer = casos.filter(c => c.status === "Em Verificação").length;
  const statsBox = document.getElementById("report-stats-gerais");
  if (statsBox) {
    statsBox.innerHTML = `
      <div class="stat-box-compact"><span class="stat-label-compact">Total</span><span class="stat-value-compact">${total}</span></div>
      <div class="stat-box-compact"><span class="stat-label-compact">Concluídos</span><span class="stat-value-compact" style="color:var(--success);">${concl}</span></div>
      <div class="stat-box-compact"><span class="stat-label-compact">Em tratativa</span><span class="stat-value-compact" style="color:var(--info);">${emVer}</span></div>
      <div class="stat-box-compact"><span class="stat-label-compact">Pendentes</span><span class="stat-value-compact" style="color:var(--warning);">${pend}</span></div>
    `;
  }

  const porMonitor = {};
  casos.forEach(c => {
    if (!c.monitorAtendente) return;
    if (!porMonitor[c.monitorAtendente]) porMonitor[c.monitorAtendente] = { total: 0, concluidos: 0, emTratativa: 0, somaMin: 0, qtdComTempo: 0 };
    const ref = porMonitor[c.monitorAtendente];
    ref.total++;
    if (c.status === "Concluído") {
      ref.concluidos++;
      if (c.concluidoEm && c.timestamp) {
        ref.somaMin += Math.round((c.concluidoEm - c.timestamp) / 60000);
        ref.qtdComTempo++;
      }
    }
    if (c.status === "Em Verificação") ref.emTratativa++;
  });

  const tabela = document.getElementById("report-tabela-monitores");
  if (tabela) {
    const linhas = Object.entries(porMonitor).sort((a,b) => b[1].concluidos - a[1].concluidos);
    if (linhas.length === 0) {
      tabela.innerHTML = `<div class="empty-cell" style="padding:24px;">Nenhum monitor atendeu chamados no período selecionado.</div>`;
    } else {
      tabela.innerHTML = `
        <table class="report-table">
          <thead><tr>
            <th class="col-monitor">Monitor</th>
            <th class="col-num">Atendidos</th>
            <th class="col-num">Concluídos</th>
            <th class="col-num">Em tratativa</th>
            <th class="col-num">Tempo médio</th>
          </tr></thead>
          <tbody>
            ${linhas.map(([nome, s]) => `
              <tr>
                <td class="col-monitor"><strong>${escapeHtml(nome)}</strong></td>
                <td class="col-num">${s.total}</td>
                <td class="col-num" style="color:var(--success);">${s.concluidos}</td>
                <td class="col-num" style="color:var(--info);">${s.emTratativa}</td>
                <td class="col-num">${s.qtdComTempo ? Math.round(s.somaMin / s.qtdComTempo) + " min" : "—"}</td>
              </tr>`).join("")}
          </tbody>
        </table>`;
    }
  }
};

// --------------------------------------------------------------------------
// ENTER NOS LOGINS
// --------------------------------------------------------------------------
function ligarEnter(el, fn) {
  if (!el) return;
  el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); fn(); } });
}

// --------------------------------------------------------------------------
// INICIALIZAÇÃO
// --------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  if (typeof window.inicializarSincronismoFirebase === "function") {
    window.inicializarSincronismoFirebase();
  }

  ligarEnter(document.getElementById("op-nome"),            () => window.iniciarSessaoOperadorMock());
  ligarEnter(document.getElementById("op-pa"),              () => window.iniciarSessaoOperadorMock());
  ligarEnter(document.getElementById("monitor-nome-login"), () => window.loginMonitorMock());
  ligarEnter(document.getElementById("monitor-senha-login"),() => window.loginMonitorMock());
  ligarEnter(document.getElementById("admin-senha-login"),  () => window.loginAdminMock());

  document.getElementById("limpeza-periodo")?.addEventListener("change", atualizarPreviewLimpeza);

  document.getElementById("modal-notif-operador")?.addEventListener("click", (e) => {
    if (e.target.id === "modal-notif-operador") window.fecharModalNotificacoes();
  });
  document.getElementById("modal-detalhe-caso")?.addEventListener("click", (e) => {
    if (e.target.id === "modal-detalhe-caso") window.fecharModalCaso();
  });
  document.getElementById("modal-editar-caso")?.addEventListener("click", (e) => {
    if (e.target.id === "modal-editar-caso") window.fecharModalEdicaoCaso();
  });

  if (operadorSessao) {
    document.getElementById("txt-op-nome").innerText = operadorSessao.nome;
    document.getElementById("txt-op-pa").innerText = `PA ${operadorSessao.pa}`;
    document.getElementById("form-identificacao").style.display = "none";
    document.getElementById("area-operador").style.display = "block";
    window.irPara("tela-operador");
  }

  if (monitorSessao) {
    document.getElementById("txt-nome-monitor-logado").innerHTML =
      `<i class="fa-solid fa-user-shield"></i> Monitor conectado: <strong>${escapeHtml(monitorSessao.nome)}</strong>`;
    const optDisp = document.getElementById("status-opt-disp");
    const optNp = document.getElementById("status-opt-np");
    if (optDisp) optDisp.className = monitorSessao.status === "Disponível" ? "status-opt active-disp" : "status-opt";
    if (optNp)   optNp.className   = monitorSessao.status === "Não Perturbe" ? "status-opt active-np" : "status-opt";

    aposFirebaseCarregar(() => {
      window.salvarItem("monitores_online", {
        id: monitorSessao.id, sessionId: monitorSessao.sessionId,
        nome: monitorSessao.nome, status: monitorSessao.status, lastSeen: Date.now(),
      });
    });
    iniciarHeartbeat();
    window.irPara("tela-monitor");
  }

  if (adminSessao) window.irPara("tela-admin");

  window.renderizarTudo();
});
