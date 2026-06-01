/* ==========================================================================
   Teleflow • v6.1 (HOTFIX concorrência)
   Correção crítica:
   - Toda escrita no Firebase agora é GRANULAR por item (set/remove no path
     específico do id). Antes, sincronizarStorage() fazia fbSet na raiz
     inteira (teleflow_root), e com múltiplos usuários simultâneos a última
     escrita sobrescrevia a árvore inteira com um snapshot defasado —
     causando o "sumiço" de casos, alertas e notificações.
   - sincronizarStorage() é mantido apenas como no-op de compatibilidade.
   ========================================================================== */

console.log("Teleflow v6.1 • Escrita granular por item (hotfix concorrência)");

// --------------------------------------------------------------------------
// CONFIG
// --------------------------------------------------------------------------
const ADMIN_PASSWORD       = "casemiro2026";
const MONITOR_PASSWORD     = null;              // null = aceita qualquer senha
const HEARTBEAT_INTERVALO  = 25_000;            // 25 s
const HEARTBEAT_EXPIRACAO  = 75_000;            // 75 s sem heartbeat = offline
const CHAVE_NOTIF_LIDAS    = "teleflow_notif_dismissed"; // local-only

// --------------------------------------------------------------------------
// ESTADO
// --------------------------------------------------------------------------
let localDB = { casos: [], alertas_pa: [], monitores_online: [], notificacoes: [] };
let controleTamanhoAntigo = { alertas: 0, notif: 0 };
let arquivoAberto = false;
let idCasoModalAberto = null;
let heartbeatTimer = null;

// Proteção: só permite escrita no Firebase após o primeiro snapshot.
let firebaseCarregado = false;
const filaPosCarga = [];

let operadorSessao = JSON.parse(sessionStorage.getItem("teleflow_op_session"))    || null;
let monitorSessao  = JSON.parse(sessionStorage.getItem("teleflow_mon_session"))   || null;
let adminSessao    = JSON.parse(sessionStorage.getItem("teleflow_admin_session")) || null;

// --------------------------------------------------------------------------
// SINCRONISMO FIREBASE
// --------------------------------------------------------------------------
window.inicializarSincronismoFirebase = function () {
  if (!window.fbDB) return;
  const dbRef = window.fbRef(window.fbDB, "teleflow_root");

  window.fbOnValue(dbRef, (snapshot) => {
    const dados = snapshot.val();

    localDB.casos             = dados?.casos             ? Object.values(dados.casos)             : [];
    localDB.alertas_pa        = dados?.alertas_pa        ? Object.values(dados.alertas_pa)        : [];
    localDB.monitores_online  = dados?.monitores_online  ? Object.values(dados.monitores_online)  : [];
    localDB.notificacoes      = dados?.notificacoes      ? Object.values(dados.notificacoes)      : [];

    // Alerta presencial novo
    if (localDB.alertas_pa.length > controleTamanhoAntigo.alertas) {
      const ultimo = localDB.alertas_pa[localDB.alertas_pa.length - 1];
      if (ultimo && ultimo.status === "Aguardando" && monitorSessao) {
        window.lancarNotificacaoVisualMonitor(
          `ALERTA CRÍTICO: PA ${ultimo.pa} (${ultimo.operador}) solicita suporte presencial!`
        );
      }
    }
    controleTamanhoAntigo.alertas = localDB.alertas_pa.length;

    // Novo comunicado admin para operador
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

    window.renderizarTudo();
    if (idCasoModalAberto) window.atualizarApenasTempoEStatusModal();
  });
};

/* ----------------------------------------------------------------------
   ESCRITA GRANULAR (hotfix v6.1)
   Cada mutação grava SOMENTE o item alterado no path específico do id.
   Isso evita que dois clientes sobrescrevam a árvore inteira com snapshots
   defasados — causa raiz do sumiço de casos relatado em produção.
   ---------------------------------------------------------------------- */
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
    window.fbSet(window.fbRef(window.fbDB, `teleflow_root/${secao}/${item.id}`), item);
  } catch (e) { console.error("[salvarItem]", secao, e); }
};

window.removerItem = function (secao, id) {
  if (!_podeEscrever() || !id) return;
  try {
    window.fbRemove(window.fbRef(window.fbDB, `teleflow_root/${secao}/${id}`));
  } catch (e) { console.error("[removerItem]", secao, id, e); }
};

window.removerVarios = function (secao, ids) {
  if (!_podeEscrever() || !ids || !ids.length) return;
  try {
    const updates = {};
    ids.forEach(id => { updates[`teleflow_root/${secao}/${id}`] = null; });
    window.fbUpdate(window.fbRef(window.fbDB, "/"), updates);
  } catch (e) { console.error("[removerVarios]", secao, e); }
};

// Mantido apenas por compatibilidade — NÃO usar mais; era a causa do bug.
window.sincronizarStorage = function () { /* no-op desde v6.1 */ };

function aposFirebaseCarregar(fn) {
  if (firebaseCarregado) fn();
  else filaPosCarga.push(fn);
}

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
  toast.innerHTML = `${icones[tipo] || icones.info} <span>${mensagem}</span>`;
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
/**
 * Lista de monitores únicos por nome, ativos (com heartbeat válido).
 * Status agregado: se qualquer sessão estiver "Disponível", o monitor
 * aparece como Disponível; se TODAS as sessões estiverem em "Não Perturbe",
 * aparece como Indisponível.
 */
function getMonitoresAtivosUnicos() {
  const agora = Date.now();
  const ativos = localDB.monitores_online.filter(m =>
    !m.lastSeen || (agora - m.lastSeen) < HEARTBEAT_EXPIRACAO
  );
  const porNome = new Map();
  ativos.forEach(m => {
    const atual = porNome.get(m.nome);
    if (!atual) {
      porNome.set(m.nome, { nome: m.nome, status: m.status || "Disponível", sessoes: 1 });
    } else {
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
    const idx = localDB.monitores_online.findIndex(m => m.id === monitorSessao.id);
    if (idx === -1) localDB.monitores_online.push(registro);
    else localDB.monitores_online[idx] = registro;
    // Escrita granular: apenas a MINHA sessão.
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

// Limpeza periódica APENAS de sessões fantasmas (sem heartbeat) — nunca de casos.
setInterval(() => {
  if (!firebaseCarregado) return;
  const agora = Date.now();
  const fantasmas = localDB.monitores_online.filter(m =>
    m.lastSeen && (agora - m.lastSeen) >= HEARTBEAT_EXPIRACAO
  );
  if (fantasmas.length) {
    const ids = fantasmas.map(m => m.id);
    localDB.monitores_online = localDB.monitores_online.filter(m => !ids.includes(m.id));
    window.removerVarios("monitores_online", ids);
  }
  window.renderizarTudo();
}, 30_000);

// Ao fechar a aba: remove apenas a sessão DESTA aba (não derruba outras)
window.addEventListener("beforeunload", () => {
  if (!monitorSessao || !window.fbDB) return;
  try {
    window.fbRemove(window.fbRef(
      window.fbDB, `teleflow_root/monitores_online/${monitorSessao.id}`
    ));
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

window.enviarCasoMock = function () {
  if (!operadorSessao) return;
  const inputId = document.getElementById("caso-id-edicao");
  const inputTitulo = document.getElementById("caso-titulo");
  const inputDesc = document.getElementById("caso-descricao");
  const selectMonitor = document.getElementById("caso-monitor-direcionado");

  const titulo = inputTitulo?.value.trim();
  const descricao = inputDesc?.value.trim();
  const monitorDirecionado = selectMonitor?.value || "";

  if (!titulo || !descricao) { window.lancarToast("Preencha o título e a descrição do caso.", "danger"); return; }

  let casoParaSalvar = null;

  if (inputId && inputId.value) {
    const idx = localDB.casos.findIndex((c) => c.id === inputId.value);
    if (idx !== -1) {
      Object.assign(localDB.casos[idx], { titulo, descricao, monitorDirecionado });
      casoParaSalvar = localDB.casos[idx];
      window.lancarToast("Chamado atualizado com sucesso.", "success");
    }
    inputId.value = "";
    document.getElementById("btn-enviar-chamado").innerHTML = '<i class="fa-solid fa-paper-plane"></i> Transmitir para fila de triagem';
    document.getElementById("label-status-formulario").innerText = "Assunto / título do caso";
  } else {
    casoParaSalvar = {
      id: "C-" + Date.now() + "-" + Math.floor(1000 + Math.random() * 9000),
      operador: operadorSessao.nome,
      pa: operadorSessao.pa,
      titulo, descricao, monitorDirecionado,
      status: "Pendente",
      timestamp: Date.now(),
      monitorAtendente: "",
      respostaFeedback: "",
    };
    localDB.casos.unshift(casoParaSalvar);
    window.lancarToast("Caso enviado para triagem.", "success");
  }

  if (inputTitulo) inputTitulo.value = "";
  if (inputDesc) inputDesc.value = "";
  if (selectMonitor) selectMonitor.value = "";
  if (casoParaSalvar) window.salvarItem("casos", casoParaSalvar);
};

window.editarCasoOperadorMock = function (id) {
  const caso = localDB.casos.find((c) => c.id === id);
  if (!caso) return;
  if (caso.status !== "Pendente") { window.lancarToast("Este chamado já está em atendimento.", "danger"); return; }

  document.getElementById("caso-id-edicao").value = caso.id;
  document.getElementById("caso-titulo").value = caso.titulo;
  document.getElementById("caso-descricao").value = caso.descricao;
  document.getElementById("caso-monitor-direcionado").value = caso.monitorDirecionado || "";
  document.getElementById("btn-enviar-chamado").innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Salvar alterações';
  document.getElementById("label-status-formulario").innerHTML = 'Assunto / título do caso <span style="color:var(--warning); font-size:0.75rem;">(modo edição)</span>';

  window.lancarToast("Dados do chamado carregados.", "info");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

window.cancelarCasoOperadorMock = function (id) {
  const caso = localDB.casos.find((c) => c.id === id);
  if (!caso) return;
  if (caso.status !== "Pendente") { window.lancarToast("Não é possível cancelar um chamado em andamento.", "danger"); return; }
  if (confirm("Deseja realmente cancelar e excluir este chamado?")) {
    localDB.casos = localDB.casos.filter((c) => c.id !== id);
    window.removerItem("casos", id);
    window.lancarToast("Chamado removido da fila.", "info");
  }
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

// Dispensa LOCAL (não apaga do banco — outros operadores continuam vendo)
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
    const tipo = n.tipo || "info";
    const titulo = n.titulo || "Comunicado";
    return `
      <div class="notif-item ${tipo} ${expandida ? 'expandida' : ''}" onclick="expandirNotificacao('${n.id}')">
        <div class="notif-item-header">
          <div class="notif-item-title">
            <span class="notif-pill notif-pill-${tipo}">${tipo.toUpperCase()}</span>
            <strong>${titulo}</strong>
          </div>
          <div class="notif-item-meta">
            <span class="notif-time">${new Date(n.timestamp).toLocaleString("pt-BR")}</span>
            <button class="notif-dismiss" onclick="event.stopPropagation(); dispensarComunicado('${n.id}')" title="Marcar como lido para mim">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>
        <div class="notif-item-body">
          ${expandida
            ? `<div class="notif-item-full">${n.mensagem}</div>`
            : `<div class="notif-item-preview">${n.mensagem}</div>`}
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
    sessionId,
    nome,
    status: "Disponível",
  };
  sessionStorage.setItem("teleflow_mon_session", JSON.stringify(monitorSessao));

  aposFirebaseCarregar(() => {
    const registro = {
      id: monitorSessao.id,
      sessionId,
      nome,
      status: "Disponível",
      lastSeen: Date.now(),
    };
    // NÃO remove outras sessões do mesmo nome — multi-PC suportado.
    localDB.monitores_online.push(registro);
    window.salvarItem("monitores_online", registro);
  });

  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();

  document.getElementById("txt-nome-monitor-logado").innerHTML =
    `<i class="fa-solid fa-user-shield"></i> Monitor conectado: <strong>${nome}</strong>`;
  document.getElementById("monitor-senha-login").value = "";
  document.getElementById("monitor-nome-login").value = "";

  window.irPara("tela-monitor");
  window.lancarToast(`Console inicializado para ${nome}.`, "success");
  iniciarHeartbeat();
};

window.deslogarMonitorMock = function () {
  if (monitorSessao) {
    // Remove APENAS esta sessão; outras abas/PCs do mesmo nome continuam ativas.
    const idSair = monitorSessao.id;
    localDB.monitores_online = localDB.monitores_online.filter((m) => m.id !== idSair);
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
  const idx = localDB.monitores_online.findIndex((m) => m.id === monitorSessao.id);
  let registro;
  if (idx !== -1) {
    localDB.monitores_online[idx].status = novoStatus;
    localDB.monitores_online[idx].lastSeen = Date.now();
    registro = localDB.monitores_online[idx];
  } else {
    registro = {
      id: monitorSessao.id, sessionId: monitorSessao.sessionId,
      nome: monitorSessao.nome, status: novoStatus, lastSeen: Date.now(),
    };
    localDB.monitores_online.push(registro);
  }
  const optDisp = document.getElementById("status-opt-disp");
  const optNp = document.getElementById("status-opt-np");
  if (optDisp) optDisp.className = novoStatus === "Disponível" ? "status-opt active-disp" : "status-opt";
  if (optNp)   optNp.className   = novoStatus === "Não Perturbe" ? "status-opt active-np" : "status-opt";

  window.lancarToast(`Status alterado: ${novoStatus === "Disponível" ? "Disponível" : "Indisponível"}`, "info");
  window.salvarItem("monitores_online", registro);
};

window.atenderCasoMonitorMock = function (id) {
  if (!monitorSessao) return;
  const caso = localDB.casos.find((c) => c.id === id);
  if (!caso) return;
  caso.status = "Em Verificação";
  caso.monitorAtendente = monitorSessao.nome;
  window.salvarItem("casos", caso);
  window.lancarToast(`Você assumiu a tratativa do chamado ${id}.`, "success");
  window.abrirModalCaso(id);
};

window.concluirCasoMonitorMock = function (id, feedbackTexto) {
  const caso = localDB.casos.find((c) => c.id === id);
  if (!caso) return;
  caso.status = "Concluído";
  caso.respostaFeedback = feedbackTexto || "Atendimento avaliado e concluído pela supervisão.";
  caso.concluidoEm = Date.now();
  window.salvarItem("casos", caso);
  window.lancarToast(`Chamado ${id} solucionado.`, "success");
};

window.atenderAlertaPresencialMock = function (id) {
  if (!monitorSessao) return;
  const alerta = localDB.alertas_pa.find((a) => a.id === id);
  if (!alerta) return;
  alerta.status = "Em Atendimento";
  alerta.monitorAtendente = monitorSessao.nome;
  window.salvarItem("alertas_pa", alerta);
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
  localDB.monitores_online = localDB.monitores_online.filter(m => m.id !== monitorId);
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

function filtrarCasosPorPeriodo(periodo, base = localDB.casos) {
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
    periodo,
    totalCasos: casos.length,
    casos: casos.map(c => ({
      id: c.id,
      operador: c.operador,
      pa: c.pa,
      titulo: c.titulo,
      descricao: c.descricao,
      monitorDirecionado: c.monitorDirecionado || null,
      monitorAtendente: c.monitorAtendente || null,
      status: c.status,
      respostaFeedback: c.respostaFeedback || null,
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
  // Seleciona SOMENTE concluídos dentro do período.
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
  const setIds = new Set(idsApagar);
  const antes = localDB.casos.length;
  localDB.casos = localDB.casos.filter(c => !setIds.has(c.id));
  const removidos = antes - localDB.casos.length;

  // Apaga SOMENTE os ids selecionados (concluídos do período). Pendentes
  // e Em Verificação não são tocados em hipótese alguma.
  window.removerVarios("casos", idsApagar);
  window.lancarToast(`${removidos} caso(s) concluído(s) apagado(s).`, "success");
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
// MODAL DETALHE
// --------------------------------------------------------------------------
window.abrirModalCaso = function (id) {
  const caso = localDB.casos.find((c) => c.id === id);
  if (!caso) return;
  idCasoModalAberto = id;
  const modal = document.getElementById("modal-detalhe-caso");
  if (!modal) return;

  document.getElementById("modal-titulo-caso").innerText = caso.titulo;
  document.getElementById("modal-descricao-caso").innerText = caso.descricao;
  document.getElementById("modal-op-pa").innerHTML =
    `<i class="fa-solid fa-headset"></i> Operador: <strong>${caso.operador}</strong> (PA ${caso.pa})`;

  const areaTratativa = document.getElementById("modal-area-tratativa");
  const areaResposta = document.getElementById("modal-area-resposta-concluida");
  const inputFeedback = document.getElementById("modal-input-feedback");
  const btnFinalizar = document.getElementById("modal-btn-finalizar");

  if (caso.status === "Em Verificação" && monitorSessao && caso.monitorAtendente === monitorSessao.nome) {
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
      `<strong><i class="fa-solid fa-user-shield"></i> Solucionado por ${caso.monitorAtendente}:</strong>` +
      `<p style="margin-top:8px;">${caso.respostaFeedback}</p>`;
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
  const caso = localDB.casos.find(c => c.id === idCasoModalAberto);
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
  const caso = localDB.casos.find((c) => c.id === idCasoModalAberto);
  const el = document.getElementById("modal-timer-status");
  if (!caso || !el) return;
  const minPassados = Math.floor((Date.now() - caso.timestamp) / 60000);
  let badge = "";
  if (caso.status === "Pendente")       badge = `<span class="badge warning">Aguardando (${minPassados}m)</span>`;
  if (caso.status === "Em Verificação") badge = `<span class="badge info">Em tratativa por ${caso.monitorAtendente} (${minPassados}m)</span>`;
  if (caso.status === "Concluído")      badge = `<span class="badge success">Solucionado</span>`;
  el.innerHTML = badge;
};

// --------------------------------------------------------------------------
// RENDERIZAÇÃO PRINCIPAL
// --------------------------------------------------------------------------
window.renderizarTudo = function () {
  const min = (t) => Math.floor((Date.now() - t) / 60000);
  const monitoresAtivos = getMonitoresAtivosUnicos();

  // 1. Monitores online (visão do operador)
  const gridMonitores = document.getElementById("grid-monitores-online");
  if (gridMonitores && operadorSessao) {
    if (monitoresAtivos.length === 0) {
      gridMonitores.innerHTML =
        `<div style="grid-column:1/-1; color:var(--text-muted); font-size:0.85rem; font-style:italic;">Nenhum monitor conectado no momento. Suas requisições entram na fila global.</div>`;
    } else {
      gridMonitores.innerHTML = monitoresAtivos
        .map(m => {
          const indisp = m.status !== "Disponível";
          const sufixo = indisp ? " (Indisponível)" : "";
          return `
            <div class="monitor-status-card ${indisp ? 'np' : 'disp'}">
              <strong>${m.nome}${sufixo}</strong>
              <span>${indisp ? 'Indisponível' : 'Disponível'}</span>
            </div>`;
        })
        .join("");
    }
  }

  // 2. Sino de notificações
  window.renderizarSino();
  if (document.getElementById("modal-notif-operador")?.classList.contains("open")) {
    window.renderizarModalNotificacoes();
  }

  // 3. Alerta presencial / botão chamada
  const boxAlertaOp = document.getElementById("alerta-suporte-operador");
  const btnChamarMon = document.getElementById("btn-chamar-monitor");
  if (operadorSessao) {
    const alerta = localDB.alertas_pa.find((a) => a.pa === operadorSessao.pa);
    if (alerta && boxAlertaOp) {
      boxAlertaOp.style.display = "block";
      boxAlertaOp.className = "emergency-item";
      if (alerta.status === "Aguardando") {
        boxAlertaOp.innerHTML =
          `<div><i class="fa-solid fa-spinner fa-spin" style="color:var(--warning);"></i> <strong>Chamado presencial ativo:</strong> aguardando monitor na PA ${alerta.pa}.</div>
           <button class="btn-back" style="margin:0;" onclick="cancelarAlertaPresencialOperadorMock('${alerta.id}')">Cancelar</button>`;
      } else {
        boxAlertaOp.style.borderLeftColor = "var(--success)";
        boxAlertaOp.innerHTML =
          `<div><i class="fa-solid fa-user-check" style="color:var(--success);"></i> <strong>Monitor a caminho:</strong> ${alerta.monitorAtendente} se deslocando até sua PA.</div>`;
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
    const meus = localDB.casos.filter((c) => c.operador === operadorSessao.nome);
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
            <button class="btn-secondary" onclick="event.stopPropagation(); editarCasoOperadorMock('${c.id}')"><i class="fa-solid fa-pen"></i> Editar</button>
            <button class="btn-danger" onclick="event.stopPropagation(); cancelarCasoOperadorMock('${c.id}')"><i class="fa-solid fa-trash"></i> Cancelar</button>
          </div>`;
        } else if (c.status === "Em Verificação") {
          badge = `<span class="badge info">Em suporte por ${c.monitorAtendente}</span>`;
        } else {
          badge = `<span class="badge success">Solucionado</span>`;
        }
        const labelDir = c.monitorDirecionado
          ? `<div class="tag-monitor-direcionado"><i class="fa-solid fa-arrow-turn-up"></i> ${c.monitorDirecionado}</div>` : "";
        card.innerHTML = `
          <div class="card-top-info"><span>${c.id}</span> ${badge}</div>
          <h4>${c.titulo}</h4>
          <p class="desc-truncada">${c.descricao}</p>
          ${labelDir}${acoes}`;
        card.addEventListener("click", (e) => {
          if (e.target.closest(".card-actions-row")) return;
          window.abrirModalCaso(c.id);
        });
        listaOp.appendChild(card);
      });
    }
  }

  // 5. Painel emergências (monitor)
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
               <div>🚨 <strong>PA ${a.pa}</strong> — ${a.operador} aguarda suporte (${min(a.timestamp)}m)</div>
               <button onclick="atenderAlertaPresencialMock('${a.id}')" class="btn-success"><i class="fa-solid fa-person-walking-arrow-right"></i> Prestar suporte</button>
             </div>`
          : `<div class="emergency-item" style="border-left-color:var(--success);">
               <div><i class="fa-solid fa-check-double" style="color:var(--success);"></i> ${a.monitorAtendente} em atendimento na PA ${a.pa}.</div>
               <button onclick="concluirAlertaPresencialMock('${a.id}')" class="btn-secondary"><i class="fa-solid fa-circle-check"></i> Finalizar</button>
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
    localDB.casos.forEach((c) => {
      if (c.status === "Pendente") totalPend++;
      if (c.status === "Concluído") totalConcl++;
      const matchBusca =
        c.operador.toLowerCase().includes(termo) ||
        c.titulo.toLowerCase().includes(termo) ||
        c.descricao.toLowerCase().includes(termo) ||
        c.pa.toString().includes(termo) ||
        c.id.toLowerCase().includes(termo);
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
        acao = `<button class="btn-success" onclick="event.stopPropagation(); atenderCasoMonitorMock('${c.id}')"><i class="fa-solid fa-handshake-angle"></i> Assumir tratativa</button>`;
      } else if (c.status === "Em Verificação") {
        const souEu = monitorSessao && c.monitorAtendente === monitorSessao.nome;
        badge = `<span class="badge info">${souEu ? "Sob sua análise" : "Com " + c.monitorAtendente}</span>`;
        acao = `<button class="btn-secondary" onclick="event.stopPropagation(); abrirModalCaso('${c.id}')"><i class="fa-solid fa-folder-open"></i> ${souEu ? "Responder & finalizar" : "Visualizar"}</button>`;
      } else {
        badge = `<span class="badge success">Solucionado</span>`;
        acao = `<button class="btn-secondary" onclick="event.stopPropagation(); abrirModalCaso('${c.id}')"><i class="fa-solid fa-eye"></i> Rever</button>`;
      }
      const labelDir = c.monitorDirecionado
        ? `<div class="tag-monitor-direcionado ${monitorSessao && c.monitorDirecionado === monitorSessao.nome ? "destacado" : ""}"><i class="fa-solid fa-user-tag"></i> ${c.monitorDirecionado}</div>` : "";
      card.innerHTML = `
        <div class="card-top-info"><strong>PA ${c.pa} • ${c.operador}</strong> ${badge}</div>
        <h4>${c.titulo}</h4>
        <p class="desc-truncada">${c.descricao}</p>
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

  // 7. Renderização do admin (se tela ativa)
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
          <div><div class="am-name">${m.nome}</div>
            <div class="am-meta">Sessão: ${m.sessionId || m.id} · Último sinal: ${m.lastSeen ? new Date(m.lastSeen).toLocaleTimeString("pt-BR") : "—"}</div>
          </div>
          ${badgeStatus}
        </div>
        <div class="am-actions">
          <button class="btn-danger" onclick="forcarLogoutMonitorAdmin('${m.id}', '${m.nome.replace(/'/g, "\\'")}')">
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
  cont.innerHTML = ordenadas.map(n => `
    <div class="notif-history-item ${n.tipo || "info"}">
      <div>
        <strong>${(n.tipo || "info").toUpperCase()}${n.titulo ? ' · ' + n.titulo : ''}:</strong> ${n.mensagem}
        <div class="nh-time">${new Date(n.timestamp).toLocaleString("pt-BR")}</div>
      </div>
      <button onclick="removerNotificacaoAdmin('${n.id}')"><i class="fa-solid fa-trash"></i> Remover</button>
    </div>`).join("");
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
                <td class="col-monitor"><strong>${nome}</strong></td>
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
// SUPORTE A "ENTER" NOS LOGINS
// --------------------------------------------------------------------------
function ligarEnter(el, fn) {
  if (!el) return;
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); fn(); }
  });
}

// --------------------------------------------------------------------------
// INICIALIZAÇÃO
// --------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  if (typeof window.inicializarSincronismoFirebase === "function") {
    window.inicializarSincronismoFirebase();
  }

  // Enter em todas as telas de login
  ligarEnter(document.getElementById("op-nome"),            () => window.iniciarSessaoOperadorMock());
  ligarEnter(document.getElementById("op-pa"),              () => window.iniciarSessaoOperadorMock());
  ligarEnter(document.getElementById("monitor-nome-login"), () => window.loginMonitorMock());
  ligarEnter(document.getElementById("monitor-senha-login"),() => window.loginMonitorMock());
  ligarEnter(document.getElementById("admin-senha-login"),  () => window.loginAdminMock());

  // Preview da limpeza atualiza com o select
  document.getElementById("limpeza-periodo")?.addEventListener("change", atualizarPreviewLimpeza);

  // Fecha modal de notificações ao clicar fora
  document.getElementById("modal-notif-operador")?.addEventListener("click", (e) => {
    if (e.target.id === "modal-notif-operador") window.fecharModalNotificacoes();
  });
  document.getElementById("modal-detalhe-caso")?.addEventListener("click", (e) => {
    if (e.target.id === "modal-detalhe-caso") window.fecharModalCaso();
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
      `<i class="fa-solid fa-user-shield"></i> Monitor conectado: <strong>${monitorSessao.nome}</strong>`;
    const optDisp = document.getElementById("status-opt-disp");
    const optNp = document.getElementById("status-opt-np");
    if (optDisp) optDisp.className = monitorSessao.status === "Disponível" ? "status-opt active-disp" : "status-opt";
    if (optNp)   optNp.className   = monitorSessao.status === "Não Perturbe" ? "status-opt active-np" : "status-opt";

    // Re-registra esta sessão (sessionId preservado em sessionStorage)
    aposFirebaseCarregar(() => {
      if (!localDB.monitores_online.find(m => m.id === monitorSessao.id)) {
        const registro = {
          id: monitorSessao.id,
          sessionId: monitorSessao.sessionId,
          nome: monitorSessao.nome,
          status: monitorSessao.status,
          lastSeen: Date.now(),
        };
        localDB.monitores_online.push(registro);
        window.salvarItem("monitores_online", registro);
      }
    });
    iniciarHeartbeat();
    window.irPara("tela-monitor");
  }

  if (adminSessao) {
    window.irPara("tela-admin");
  }

  window.renderizarTudo();
});
