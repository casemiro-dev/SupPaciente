/* ==========================================================================
   Teleflow • Lógica de aplicação
   --------------------------------------------------------------------------
   - Sincronismo realtime via Firebase (escuta reativa em "teleflow_root")
   - Sessão local em sessionStorage (operador/monitor)
   - Renderização declarativa em window.renderizarTudo()
   ========================================================================== */

console.log("Teleflow v4.1 • Sincronismo Realtime Firebase");

// --------------------------------------------------------------------------
// ESTADO
// --------------------------------------------------------------------------
let localDB = { casos: [], alertas_pa: [], monitores_online: [] };
let controleTamanhoAntigo = { alertas: 0 };
let arquivoAberto = false;
let idCasoModalAberto = null;

let operadorSessao = JSON.parse(sessionStorage.getItem("teleflow_op_session")) || null;
let monitorSessao  = JSON.parse(sessionStorage.getItem("teleflow_mon_session")) || null;

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

    // Notificação visual: novo alerta presencial
    if (localDB.alertas_pa.length > controleTamanhoAntigo.alertas) {
      const ultimo = localDB.alertas_pa[localDB.alertas_pa.length - 1];
      if (ultimo && ultimo.status === "Aguardando" && monitorSessao) {
        window.lancarNotificacaoVisualMonitor(
          `ALERTA CRÍTICO: PA ${ultimo.pa} (${ultimo.operador}) solicita suporte presencial!`
        );
      }
    }
    controleTamanhoAntigo.alertas = localDB.alertas_pa.length;

    window.renderizarTudo();
    if (idCasoModalAberto) window.atualizarApenasTempoEStatusModal();
  });
};

window.sincronizarStorage = function () {
  if (!window.fbDB) return;
  window.fbSet(window.fbRef(window.fbDB, "teleflow_root"), {
    casos:            localDB.casos.reduce((a, c) => ({ ...a, [c.id]: c }), {}),
    alertas_pa:       localDB.alertas_pa.reduce((a, x) => ({ ...a, [x.id]: x }), {}),
    monitores_online: localDB.monitores_online.reduce((a, m) => ({ ...a, [m.id]: m }), {}),
  });
};

window.carregarBanco = function () {
  // Mantido por compatibilidade — substituído pela escuta reativa do Firebase
};

// --------------------------------------------------------------------------
// NAVEGAÇÃO / UI HELPERS
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
  };

  const toast = document.createElement("div");
  toast.className = `toast ${tipo}`;
  toast.innerHTML = `${icones[tipo] || icones.info} <span>${mensagem}</span>`;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
};

window.lancarNotificacaoVisualMonitor = function (texto) {
  window.lancarToast(texto, "danger");
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("🚨 Suporte presencial • Teleflow", { body: texto });
  }
};

window.toggleArquivoRetratil = function () {
  const container = document.getElementById("container-arquivo-retratil");
  const seta      = document.getElementById("archive-arrow");
  if (!container || !seta) return;

  arquivoAberto = !arquivoAberto;
  container.classList.toggle("open", arquivoAberto);
  seta.className = arquivoAberto ? "fa-solid fa-chevron-up" : "fa-solid fa-chevron-down";
};

// --------------------------------------------------------------------------
// ROTEIROS RÁPIDOS
// --------------------------------------------------------------------------
const ROTEIROS = {
  erroAgendamento: {
    t: "Erro de Agendamento",
    d: `ADM: \nCaso: \nOS: \nSA-\nCidade: \nTerritório: \nMotivo: \nErro: Não foi possível realizar o agendamento nesse momento. Mas não se preocupe, estamos buscando o melhor horário para encaixe e o cliente será informado.\nDisponibilidade: o dia todo`,
  },
  desbloqueio: {
    t: "Desbloqueio",
    d: `Caso:\nCPF:`,
  },
  telefonia: {
    t: "Problema com Telefonia",
    d: `Caso:\nTelefonia Móvel ou Fixa: \nCPF do cliente:\nNome do Completo do Cliente:\nADM do cliente:\nNúmero da linha:\nProblema relatado:\nProcedimentos realizados:`,
  },
  cancelamento: {
    t: "Cancelamento não efetuado",
    d: `Caso atual da NCC: (seu caso)\nCPF: \nADM: \n\nCaso retenção: (caso gerado pela retenção)\n\nCliente em contato com a Retenção foi informado sobre o cancelamento, mas o plano continuou ativo.\n\n(Data do atendimento com a retenção)\nProtocolo Chat: (protocolo do chat do atendimento com a retenção)\n(colocar o nome do operador da retenção que atendeu)`,
  },
  transferencia: {
    t: "Autorização de Transferência",
    d: `Monitor que autorizou:\nCaso:\nSetor a ser transferido: \nMotivo do cancelamento ou da transferência para outro setor:\nOfertado:`,
  },
  fatura: {
    t: "Correção de Fatura",
    d: `Descrição\nCaso:\nCPF:\nContrato ADM:\nMotivo:`,
  },
  desconto: {
    t: "Desconto autorizado",
    d: `Descrição\nMonitor que autorizou:\n\nADM: \nValor do desconto: \nTempo do desconto: \nTotal do desconto: \nMotivo:\n\nCaso:\nCPF:`,
  },
};

window.aplicarScript = function (tipo) {
  const titulo = document.getElementById("caso-titulo");
  const desc   = document.getElementById("caso-descricao");
  const r = ROTEIROS[tipo];
  if (!titulo || !desc || !r) return;

  titulo.value = r.t;
  desc.value   = r.d;
  window.lancarToast("Roteiro rápido inserido no formulário.", "info");
};

// --------------------------------------------------------------------------
// FLUXOS DO OPERADOR
// --------------------------------------------------------------------------
window.iniciarSessaoOperadorMock = function () {
  const nome = document.getElementById("op-nome")?.value.trim();
  const pa   = document.getElementById("op-pa")?.value.trim();

  if (!nome || !pa) {
    window.lancarToast("Preencha seu nome e o número da PA.", "danger");
    return;
  }

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
  const pa   = document.getElementById("op-pa");   if (pa)   pa.value   = "";
  window.irPara("tela-login");
};

window.enviarCasoMock = function () {
  if (!operadorSessao) return;

  const inputId       = document.getElementById("caso-id-edicao");
  const inputTitulo   = document.getElementById("caso-titulo");
  const inputDesc     = document.getElementById("caso-descricao");
  const selectMonitor = document.getElementById("caso-monitor-direcionado");

  const titulo            = inputTitulo?.value.trim();
  const descricao         = inputDesc?.value.trim();
  const monitorDirecionado = selectMonitor?.value || "";

  if (!titulo || !descricao) {
    window.lancarToast("Preencha o título e a descrição do caso.", "danger");
    return;
  }

  if (inputId && inputId.value) {
    const idx = localDB.casos.findIndex((c) => c.id === inputId.value);
    if (idx !== -1) {
      Object.assign(localDB.casos[idx], { titulo, descricao, monitorDirecionado });
      window.lancarToast("Chamado atualizado com sucesso.", "success");
    }
    inputId.value = "";
    document.getElementById("btn-enviar-chamado").innerHTML =
      '<i class="fa-solid fa-paper-plane"></i> Transmitir para fila de triagem';
    document.getElementById("label-status-formulario").innerText = "Assunto / título do caso";
  } else {
    localDB.casos.unshift({
      id: "C-" + Math.floor(100000 + Math.random() * 900000),
      operador:  operadorSessao.nome,
      pa:        operadorSessao.pa,
      titulo,
      descricao,
      monitorDirecionado,
      status:    "Pendente",
      timestamp: Date.now(),
      monitorAtendente:  "",
      respostaFeedback:  "",
    });
    window.lancarToast("Caso enviado para triagem.", "success");
  }

  if (inputTitulo)   inputTitulo.value   = "";
  if (inputDesc)     inputDesc.value     = "";
  if (selectMonitor) selectMonitor.value = "";

  window.sincronizarStorage();
};

window.editarCasoOperadorMock = function (id) {
  const caso = localDB.casos.find((c) => c.id === id);
  if (!caso) return;

  if (caso.status !== "Pendente") {
    window.lancarToast("Este chamado já está em atendimento.", "danger");
    return;
  }

  document.getElementById("caso-id-edicao").value         = caso.id;
  document.getElementById("caso-titulo").value            = caso.titulo;
  document.getElementById("caso-descricao").value         = caso.descricao;
  document.getElementById("caso-monitor-direcionado").value = caso.monitorDirecionado || "";

  document.getElementById("btn-enviar-chamado").innerHTML =
    '<i class="fa-solid fa-pen-to-square"></i> Salvar alterações';
  document.getElementById("label-status-formulario").innerHTML =
    'Assunto / título do caso <span style="color:var(--warning); font-size:0.75rem;">(modo edição)</span>';

  window.lancarToast("Dados do chamado carregados.", "info");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

window.cancelarCasoOperadorMock = function (id) {
  const caso = localDB.casos.find((c) => c.id === id);
  if (!caso) return;
  if (caso.status !== "Pendente") {
    window.lancarToast("Não é possível cancelar um chamado em andamento.", "danger");
    return;
  }
  if (confirm("Deseja realmente cancelar e excluir este chamado?")) {
    localDB.casos = localDB.casos.filter((c) => c.id !== id);
    window.lancarToast("Chamado removido da fila.", "info");
    window.sincronizarStorage();
  }
};

window.chamarMonitorMock = function () {
  if (!operadorSessao) return;

  if (localDB.alertas_pa.some((a) => a.pa === operadorSessao.pa && a.status === "Aguardando")) {
    window.lancarToast("Você já possui uma solicitação ativa.", "danger");
    return;
  }

  localDB.alertas_pa.push({
    id:        "A-" + Date.now(),
    pa:        operadorSessao.pa,
    operador:  operadorSessao.nome,
    status:    "Aguardando",
    timestamp: Date.now(),
  });
  window.lancarToast("Alerta emitido. Aguarde o monitor na sua PA.", "success");
  window.sincronizarStorage();
};

window.cancelarAlertaPresencialOperadorMock = function (id) {
  localDB.alertas_pa = localDB.alertas_pa.filter((a) => a.id !== id);
  window.lancarToast("Solicitação cancelada.", "info");
  window.sincronizarStorage();
};

// --------------------------------------------------------------------------
// FLUXOS DO MONITOR
// --------------------------------------------------------------------------
window.loginMonitorMock = function () {
  const nome  = document.getElementById("monitor-nome-login")?.value;
  const senha = document.getElementById("monitor-senha-login")?.value;

  if (!nome || !senha) {
    window.lancarToast("Selecione seu nome e insira a credencial.", "danger");
    return;
  }

  monitorSessao = { id: "M-" + nome.toLowerCase(), nome, status: "Disponível" };
  sessionStorage.setItem("teleflow_mon_session", JSON.stringify(monitorSessao));

  localDB.monitores_online = localDB.monitores_online.filter((m) => m.nome !== nome);
  localDB.monitores_online.push({ id: monitorSessao.id, nome, status: "Disponível" });

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  document.getElementById("txt-nome-monitor-logado").innerHTML =
    `<i class="fa-solid fa-user-shield"></i> Monitor conectado: <strong>${nome}</strong>`;
  document.getElementById("monitor-senha-login").value = "";
  document.getElementById("monitor-nome-login").value  = "";

  window.irPara("tela-monitor");
  window.lancarToast(`Console inicializado para ${nome}.`, "success");
  window.sincronizarStorage();
};

window.deslogarMonitorMock = function () {
  if (monitorSessao) {
    localDB.monitores_online = localDB.monitores_online.filter((m) => m.id !== monitorSessao.id);
  }
  sessionStorage.removeItem("teleflow_mon_session");
  monitorSessao = null;
  window.irPara("tela-login");
  window.sincronizarStorage();
};

window.alterarStatusMonitorMock = function (novoStatus) {
  if (!monitorSessao) return;
  monitorSessao.status = novoStatus;
  sessionStorage.setItem("teleflow_mon_session", JSON.stringify(monitorSessao));

  const idx = localDB.monitores_online.findIndex((m) => m.id === monitorSessao.id);
  if (idx !== -1) localDB.monitores_online[idx].status = novoStatus;

  const optDisp = document.getElementById("status-opt-disp");
  const optNp   = document.getElementById("status-opt-np");
  if (optDisp) optDisp.className = novoStatus === "Disponível"   ? "status-opt active-disp" : "status-opt";
  if (optNp)   optNp.className   = novoStatus === "Não Perturbe" ? "status-opt active-np"   : "status-opt";

  window.lancarToast(
    `Status alterado: ${novoStatus === "Disponível" ? "Disponível" : "Pausa técnica"}`,
    "info"
  );
  window.sincronizarStorage();
};

window.atenderCasoMonitorMock = function (id) {
  if (!monitorSessao) return;
  const caso = localDB.casos.find((c) => c.id === id);
  if (!caso) return;

  caso.status           = "Em Verificação";
  caso.monitorAtendente = monitorSessao.nome;

  window.lancarToast(`Você assumiu a tratativa do chamado ${id}.`, "success");
  window.sincronizarStorage();
  window.abrirModalCaso(id);
};

window.concluirCasoMonitorMock = function (id, feedbackTexto) {
  const caso = localDB.casos.find((c) => c.id === id);
  if (!caso) return;
  caso.status           = "Concluído";
  caso.respostaFeedback = feedbackTexto || "Atendimento avaliado e concluído pela supervisão.";
  window.lancarToast(`Chamado ${id} solucionado.`, "success");
  window.sincronizarStorage();
};

window.atenderAlertaPresencialMock = function (id) {
  if (!monitorSessao) return;
  const alerta = localDB.alertas_pa.find((a) => a.id === id);
  if (!alerta) return;
  alerta.status           = "Em Atendimento";
  alerta.monitorAtendente = monitorSessao.nome;
  window.lancarToast(`Deslocamento registrado para a PA ${alerta.pa}.`, "info");
  window.sincronizarStorage();
};

window.concluirAlertaPresencialMock = function (id) {
  localDB.alertas_pa = localDB.alertas_pa.filter((a) => a.id !== id);
  window.lancarToast("Suporte presencial concluído.", "success");
  window.sincronizarStorage();
};

// --------------------------------------------------------------------------
// MODAL DE DETALHE
// --------------------------------------------------------------------------
window.abrirModalCaso = function (id) {
  const caso = localDB.casos.find((c) => c.id === id);
  if (!caso) return;

  idCasoModalAberto = id;
  const modal = document.getElementById("modal-detalhe-caso");
  if (!modal) return;

  document.getElementById("modal-titulo-caso").innerText      = caso.titulo;
  document.getElementById("modal-descricao-caso").innerText   = caso.descricao;
  document.getElementById("modal-op-pa").innerHTML            =
    `<i class="fa-solid fa-headset"></i> Operador: <strong>${caso.operador}</strong> (PA ${caso.pa})`;

  const areaTratativa = document.getElementById("modal-area-tratativa");
  const areaResposta  = document.getElementById("modal-area-resposta-concluida");
  const inputFeedback = document.getElementById("modal-input-feedback");
  const btnFinalizar  = document.getElementById("modal-btn-finalizar");

  if (caso.status === "Em Verificação" && monitorSessao && caso.monitorAtendente === monitorSessao.nome) {
    areaTratativa.style.display = "block";
    areaResposta.style.display  = "none";
    inputFeedback.value         = "";
    btnFinalizar.onclick = function () {
      const txt = inputFeedback.value.trim();
      if (!txt) {
        window.lancarToast("Insira o parecer técnico para encerrar.", "danger");
        return;
      }
      window.concluirCasoMonitorMock(id, txt);
      window.fecharModalCaso();
    };
  } else if (caso.status === "Concluído") {
    areaTratativa.style.display = "none";
    areaResposta.style.display  = "block";
    areaResposta.innerHTML =
      `<strong><i class="fa-solid fa-user-shield"></i> Solucionado por ${caso.monitorAtendente}:</strong>` +
      `<p style="margin-top:8px;">${caso.respostaFeedback}</p>`;
  } else {
    areaTratativa.style.display = "none";
    areaResposta.style.display  = "none";
  }

  window.atualizarApenasTempoEStatusModal();
  modal.classList.add("open");
};

window.fecharModalCaso = function () {
  document.getElementById("modal-detalhe-caso")?.classList.remove("open");
  idCasoModalAberto = null;
};

window.atualizarApenasTempoEStatusModal = function () {
  if (!idCasoModalAberto) return;
  const caso = localDB.casos.find((c) => c.id === idCasoModalAberto);
  const el   = document.getElementById("modal-timer-status");
  if (!caso || !el) return;

  const minPassados = Math.floor((Date.now() - caso.timestamp) / 60000);
  let badge = "";
  if (caso.status === "Pendente")        badge = `<span class="badge warning">Aguardando (${minPassados}m)</span>`;
  if (caso.status === "Em Verificação")  badge = `<span class="badge info">Em tratativa por ${caso.monitorAtendente} (${minPassados}m)</span>`;
  if (caso.status === "Concluído")       badge = `<span class="badge success">Solucionado</span>`;
  el.innerHTML = badge;
};

// --------------------------------------------------------------------------
// RENDERIZAÇÃO PRINCIPAL
// --------------------------------------------------------------------------
window.renderizarTudo = function () {
  const min = (t) => Math.floor((Date.now() - t) / 60000);

  // 1. Monitores online (visão do operador)
  const gridMonitores = document.getElementById("grid-monitores-online");
  if (gridMonitores && operadorSessao) {
    if (localDB.monitores_online.length === 0) {
      gridMonitores.innerHTML =
        `<div style="grid-column:1/-1; color:var(--text-muted); font-size:0.85rem; font-style:italic;">Nenhum monitor conectado no momento. Suas requisições entram na fila global.</div>`;
    } else {
      gridMonitores.innerHTML = localDB.monitores_online
        .map(
          (m) => `
          <div class="monitor-status-card ${m.status === "Disponível" ? "disp" : "np"}">
            <strong>${m.nome}</strong>
            <span>${m.status === "Disponível" ? "Disponível" : "Pausa técnica"}</span>
          </div>`
        )
        .join("");
    }
  }

  // 2. Alerta de suporte presencial / botão de chamada
  const boxAlertaOp  = document.getElementById("alerta-suporte-operador");
  const btnChamarMon = document.getElementById("btn-chamar-monitor");
  if (operadorSessao) {
    const alerta = localDB.alertas_pa.find((a) => a.pa === operadorSessao.pa);
    if (alerta && boxAlertaOp) {
      boxAlertaOp.style.display = "block";
      boxAlertaOp.className     = "emergency-item";
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
      if (boxAlertaOp)  boxAlertaOp.style.display  = "none";
      if (btnChamarMon) btnChamarMon.style.display = "inline-flex";
    }
  }

  // 3. Chamados recentes (operador)
  const listaOp = document.getElementById("lista-casos-operador");
  if (listaOp && operadorSessao) {
    const meus = localDB.casos.filter((c) => c.operador === operadorSessao.nome);
    listaOp.innerHTML = "";

    if (meus.length === 0) {
      listaOp.innerHTML =
        `<div style="grid-column:1/-1; color:var(--text-muted); padding:14px; text-align:center;">Você não realizou transmissões hoje.</div>`;
    } else {
      meus.forEach((c) => {
        const card = document.createElement("div");
        card.className = `case-card ${c.status === "Concluído" ? "card-concluido" : ""}`;

        let badge = "", acoes = "";
        if (c.status === "Pendente") {
          badge = `<span class="badge warning">Aguardando (${min(c.timestamp)}m)</span>`;
          acoes =
            `<div class="card-actions-row">
               <button class="btn-secondary" onclick="event.stopPropagation(); editarCasoOperadorMock('${c.id}')"><i class="fa-solid fa-pen"></i> Editar</button>
               <button class="btn-danger" onclick="event.stopPropagation(); cancelarCasoOperadorMock('${c.id}')"><i class="fa-solid fa-trash"></i> Cancelar</button>
             </div>`;
        } else if (c.status === "Em Verificação") {
          badge = `<span class="badge info">Em suporte por ${c.monitorAtendente}</span>`;
        } else {
          badge = `<span class="badge success">Solucionado</span>`;
        }

        const labelDir = c.monitorDirecionado
          ? `<div class="tag-monitor-direcionado"><i class="fa-solid fa-arrow-turn-up"></i> ${c.monitorDirecionado}</div>`
          : "";

        card.innerHTML = `
          <div class="card-top-info"><span>${c.id}</span> ${badge}</div>
          <h4>${c.titulo}</h4>
          <p class="desc-truncada">${c.descricao}</p>
          ${labelDir}
          ${acoes}`;

        card.addEventListener("click", (e) => {
          if (e.target.closest(".card-actions-row")) return;
          window.abrirModalCaso(c.id);
        });

        listaOp.appendChild(card);
      });
    }
  }

  // 4. Painel de emergências (monitor)
  const painelEm    = document.getElementById("painel-emergencias");
  const listaEm     = document.getElementById("lista-emergencias");
  if (painelEm && listaEm) {
    if (localDB.alertas_pa.length === 0) {
      painelEm.style.display = "none";
    } else {
      painelEm.style.display = "block";
      listaEm.innerHTML = localDB.alertas_pa
        .map((a) =>
          a.status === "Aguardando"
            ? `<div class="emergency-item">
                 <div>🚨 <strong>PA ${a.pa}</strong> — ${a.operador} aguarda suporte (${min(a.timestamp)}m)</div>
                 <button onclick="atenderAlertaPresencialMock('${a.id}')" class="btn-success"><i class="fa-solid fa-person-walking-arrow-right"></i> Prestar suporte</button>
               </div>`
            : `<div class="emergency-item" style="border-left-color:var(--success);">
                 <div><i class="fa-solid fa-check-double" style="color:var(--success);"></i> ${a.monitorAtendente} em atendimento na PA ${a.pa}.</div>
                 <button onclick="concluirAlertaPresencialMock('${a.id}')" class="btn-secondary"><i class="fa-solid fa-circle-check"></i> Finalizar</button>
               </div>`
        )
        .join("");
    }
  }

  // 5. Fila e arquivo (monitor)
  const listaFila   = document.getElementById("lista-casos-monitor");
  const listaArq    = document.getElementById("lista-casos-concluidos-monitor");
  const countArq    = document.getElementById("count-arquivados");
  const statPend    = document.getElementById("stat-pendentes");
  const statConcl   = document.getElementById("stat-concluidos");

  const termo  = document.getElementById("search-input")?.value.toLowerCase() || "";
  const filDir = document.getElementById("filter-direcionamento")?.value || "Todos";
  const filSt  = document.getElementById("filter-status")?.value || "Todos";

  if (listaFila && listaArq) {
    listaFila.innerHTML = "";
    listaArq.innerHTML  = "";

    let totalPend = 0, totalConcl = 0;

    localDB.casos.forEach((c) => {
      if (c.status === "Pendente")  totalPend++;
      if (c.status === "Concluído") totalConcl++;

      const matchBusca =
        c.operador.toLowerCase().includes(termo) ||
        c.titulo.toLowerCase().includes(termo) ||
        c.descricao.toLowerCase().includes(termo) ||
        c.pa.toString().includes(termo) ||
        c.id.toLowerCase().includes(termo);

      const matchDir =
        filDir !== "Meus" || !monitorSessao
          ? true
          : (c.monitorDirecionado === monitorSessao.nome || c.monitorAtendente === monitorSessao.nome);

      const matchSt = filSt === "Todos" ? true : c.status === filSt;

      if (!matchBusca || !matchDir || !matchSt) return;

      const card = document.createElement("div");
      card.className = `case-card ${c.status === "Concluído" ? "card-concluido" : ""}`;

      let badge = "", acao = "";
      if (c.status === "Pendente") {
        badge = `<span class="badge warning">Pendente (${min(c.timestamp)}m)</span>`;
        acao  = `<button class="btn-success" onclick="event.stopPropagation(); atenderCasoMonitorMock('${c.id}')"><i class="fa-solid fa-handshake-angle"></i> Assumir tratativa</button>`;
      } else if (c.status === "Em Verificação") {
        const souEu = monitorSessao && c.monitorAtendente === monitorSessao.nome;
        badge = `<span class="badge info">${souEu ? "Sob sua análise" : "Com " + c.monitorAtendente}</span>`;
        acao  = `<button class="btn-secondary" onclick="event.stopPropagation(); abrirModalCaso('${c.id}')"><i class="fa-solid fa-folder-open"></i> ${souEu ? "Responder & finalizar" : "Visualizar"}</button>`;
      } else {
        badge = `<span class="badge success">Solucionado</span>`;
        acao  = `<button class="btn-secondary" onclick="event.stopPropagation(); abrirModalCaso('${c.id}')"><i class="fa-solid fa-eye"></i> Rever</button>`;
      }

      const labelDir = c.monitorDirecionado
        ? `<div class="tag-monitor-direcionado ${monitorSessao && c.monitorDirecionado === monitorSessao.nome ? "destacado" : ""}"><i class="fa-solid fa-user-tag"></i> ${c.monitorDirecionado}</div>`
        : "";

      card.innerHTML = `
        <div class="card-top-info"><strong>PA ${c.pa} • ${c.operador}</strong> ${badge}</div>
        <h4>${c.titulo}</h4>
        <p class="desc-truncada">${c.descricao}</p>
        ${labelDir}
        ${acao}`;

      card.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        window.abrirModalCaso(c.id);
      });

      if (c.status === "Concluído") listaArq.appendChild(card);
      else                          listaFila.appendChild(card);
    });

    if (statPend)  statPend.innerText  = totalPend;
    if (statConcl) statConcl.innerText = totalConcl;
    if (countArq)  countArq.innerText  = listaArq.children.length;

    if (!listaFila.children.length) {
      listaFila.innerHTML =
        `<div style="grid-column:1/-1; color:var(--text-muted); padding:24px; text-align:center; font-style:italic;">Nenhum chamado ativo na fila atende aos filtros definidos.</div>`;
    }
    if (!listaArq.children.length) {
      listaArq.innerHTML =
        `<div style="grid-column:1/-1; color:var(--text-muted); padding:16px; text-align:center; font-style:italic;">Nenhum caso solucionado listado aqui.</div>`;
    }
  }
};

// --------------------------------------------------------------------------
// INICIALIZAÇÃO
// --------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  if (typeof window.inicializarSincronismoFirebase === "function") {
    window.inicializarSincronismoFirebase();
  }

  if (!monitorSessao) localDB.monitores_online = [];

  if (operadorSessao) {
    document.getElementById("txt-op-nome").innerText        = operadorSessao.nome;
    document.getElementById("txt-op-pa").innerText          = `PA ${operadorSessao.pa}`;
    document.getElementById("form-identificacao").style.display = "none";
    document.getElementById("area-operador").style.display      = "block";
    window.irPara("tela-operador");
  }

  if (monitorSessao) {
    document.getElementById("txt-nome-monitor-logado").innerHTML =
      `<i class="fa-solid fa-user-shield"></i> Monitor conectado: <strong>${monitorSessao.nome}</strong>`;
    const optDisp = document.getElementById("status-opt-disp");
    const optNp   = document.getElementById("status-opt-np");
    if (optDisp) optDisp.className = monitorSessao.status === "Disponível"   ? "status-opt active-disp" : "status-opt";
    if (optNp)   optNp.className   = monitorSessao.status === "Não Perturbe" ? "status-opt active-np"   : "status-opt";
    window.irPara("tela-monitor");
  }

  window.renderizarTudo();
});
