<div align="center">
  <br/>
  <img src="https://img.shields.io/badge/version-7.0-brightgreen?style=flat-square" alt="Version 7.0"/>
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white" alt="HTML5"/>
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white" alt="CSS3"/>
  <img src="https://img.shields.io/badge/JavaScript-ES6-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript ES6"/>
  <img src="https://img.shields.io/badge/Firebase-FFCA28?style=flat-square&logo=firebase&logoColor=black" alt="Firebase"/>
  <img src="https://img.shields.io/badge/SPA-%E2%9C%93-6c63ff?style=flat-square" alt="SPA"/>
  <br/><br/>
</div>

<h1 align="center">SupPaciente v7.0</h1>

<p align="center">
  <b>Sistema Avançado de Gestão de Chamados em Tempo Real</b><br/>
  Triagem integrada, monitoramento de operadores e painel administrativo.
</p>

<p align="center">
  <i>"Feito para operadores, monitores e administradores que precisam de agilidade e controle no atendimento."</i>
</p>

---

## Sobre o Projeto

O **SupPaciente** (também referenciado como Teleflow) é uma aplicação web SPA de alta performance desenvolvida para otimizar fluxos de atendimento, triagem de chamados e monitoramento de operadores em tempo real.

Construído sobre o **Firebase Realtime Database**, o sistema garante sincronização instantânea de estado entre três perfis de usuário: Operadores, Monitores e Administradores — todos operando simultaneamente na mesma base.

---

## Novidades da v7.0

### Otimização de Banco de Dados
- **Listeners por coleção**: Cada coleção (casos, alertas, monitores, notificações) tem seu próprio listener especializado
- **Casos com child events**: Uso de `onChildAdded`, `onChildChanged` e `onChildRemoved` com `limitToLast(300)` — apenas os casos alterados são trafegados, não mais a árvore inteira
- **Renderização com debounce**: Atualizações da UI são agrupadas em janelas de 80ms para evitar thrashing visual em rajadas de dados
- **Redução drástica de consumo**: Impacto direto nos mais de 3 GB/dia de download que a v6.3 gerava

### Edição de Casos
- **Modal próprio de edição**: Operador edita título, descrição e direcionamento em um modal dedicado
- **Edição mesmo em tratativa**: Casos em status "Em Verificação" podem ser editados sem reverter o status ou remover o monitor
- **Proteção contra concorrência**: Bloqueia edição de casos já concluídos

### Finalização por Qualquer Monitor
- **Qualquer monitor logado** pode finalizar um caso "Em Verificação", mesmo que outro monitor o tenha assumido originalmente
- **Elimina filas travadas**: Se o monitor original saiu, outro monitor pode assumir e concluir sem impedimentos

### Experiência do Usuário
- **Card fechado**: Descrição em linha corrida com `line-clamp` (3 linhas) — layout mais limpo
- **Modal aberto**: Quebras de linha preservadas para leitura completa
- **Anti-XSS**: Funções `escapeHtml`, `nl2br` e `inlineTexto` em toda a aplicação

---

## Perfis de Acesso

| Perfil | Descricao |
|---|---|
| **Operador** | Envia chamados técnicos, utiliza roteiros rápidos, solicita presenca do monitor na PA e recebe comunicados |
| **Monitor** | Visualiza fila unificada, filtra casos, fornece feedback tecnico e atende solicitacoes presenciais |
| **Administrador** | Gera relatorios, gerencia limpeza de historico, monitora sessoes ativas e envia comunicados em broadcast |

---

## Funcionalidades

### Operador

| Funcionalidade | Descricao |
|---|---|
| **Envio de Casos** | Formulario completo com titulo, descricao e direcionamento opcional para monitor especifico |
| **Roteiros Rapidos** | Scripts predefinidos para situacoes comuns: erro de agendamento, desbloqueio, telefonia, cancelamento, transferencia, correcao de fatura e desconto |
| **Edicao de Casos** | Edita titulo/descricao/direcionamento mesmo apos o monitor assumir a tratativa (modal dedicado) |
| **Cancelamento** | Exclui casos pendentes da fila |
| **Solicitacao Presencial** | Chama um monitor fisicamente na PA com alerta em tempo real |
| **Sino de Comunicados** | Modal com lista de comunicados, expansao individual e dispensa local (persistida via localStorage) |
| **Painel de Monitores** | Visualiza quais monitores estao online e seus status (Disponivel/Indisponivel) |

### Monitor

| Funcionalidade | Descricao |
|---|---|
| **Fila Unificada** | Todos os casos pendentes, em verificacao e concluidos em um unico lugar |
| **Filtros Avancados** | Pesquisa por texto, filtro por direcionamento ("Meus casos" / "Todos") e filtro por status |
| **Modal de Detalhe** | Visualiza completo: titulo, descricao, operador, PA, tempo decorrido |
| **Assumir Caso** | Coloca o caso em "Em Verificacao" e vincula o monitor |
| **Feedback Tecnico** | Escreve parecer e finaliza o chamado com resposta para o operador |
| **Multi-sessao com Heartbeat** | Suporta abertura em multiplas abas e computadores simultaneamente |
| **Alerta Presencial** | Painel destacado de emergencias com solicitacoes de suporte fisico nas PAs |
| **Historico Arquivado** | Secao retratil com casos solucionados |

### Administrador

| Funcionalidade | Descricao |
|---|---|
| **Relatorios** | Dashboard com estatisticas por periodo (hoje, 7 dias, 30 dias, historico completo) e desempenho por monitor |
| **Exportacao JSON** | Download dos casos do periodo em formato JSON estruturado |
| **Manutencao** | Limpeza manual de casos concluidos por periodo (hoje, 7 dias, 30 dias ou completo) com preview antes da acao |
| **Monitores Online** | Lista todas as sessoes ativas de monitores com opcao de desconexao forçada |
| **Notificacoes** | Envio de comunicados em broadcast com tipo (informativo, atencao, critico, confirmacao) e gerenciamento de ativos |

---

## Arquitetura do Sistema

O projeto adota uma filosofia *lean software*, estruturado em tres pilares fundamentais:

### 1. Single Page Application (index.html)
Ponto de entrada unificado que implementa uma SPA. As transicoes de tela sao geridas via manipulacao de visibilidade de componentes DOM, eliminando latencia e overhead de rede.

Telas do sistema:
- Login (escolha de perfil)
- Login do Monitor (autenticacao nominal)
- Login do Admin (senha administrativa)
- Painel do Operador
- Console do Supervisor
- Painel Administrativo (com abas: Relatorios, Manutencao, Monitores Online, Notificacoes)

### 2. Design System v3.3 (style.css)
Arquitetura CSS robusta fundamentada em **CSS Variables** (Design Tokens):

- **Tema Escuro e Claro** com alternancia suave e persistencia
- **Utilitarios de estado**: info, success, warning, danger com variantes suaves
- **Componentes modulares**: cards, modais, botoes, badges, formularios
- **Layout responsivo** com Grid e Flexbox
- **Micro-interacoes**: hover, active, focus, transicoes consistentes
- **Scrollbar customizada**

### 3. Core Engine (script.js)
Logica central responsavel por:

- **Sincronismo Firebase otimizado**: Listeners por colecao com child events e debounce
- **Controle de estado local (localDB)**: Dicionario de casos com indices otimizados
- **Multi-sessao com Heartbeat**: Sessao identificada por ID unico com renovacao a cada 25s e expiracao em 75s
- **Sistema de notificacoes**: Toast e notificacoes visuais
- **Protecao contra XSS**: Sanitizacao de toda entrada do usuario
- **Seguranca de escrita**: Bloqueio de operacoes antes do carregamento completo do Firebase

---

## Multi-sessao do Monitor (Heartbeat)

O sistema suporta abertura do console do monitor em **multiplas abas e multiplos computadores simultaneamente**:

1. Cada sessao recebe um `sessionId` unico
2. Um heartbeat e enviado a cada **25 segundos** para o Firebase
3. Sessoes sem heartbeat por **75 segundos** sao consideradas expiradas
4. Um worker interno limpa sessoes fantasmas a cada 30 segundos
5. O fechamento de uma aba aciona `beforeunload` para remover a sessao
6. O encerramento de uma sessao nao derruba as demais

---

## Tecnologias

| Tecnologia | Aplicacao |
|---|---|
| **HTML5 Semantico** | Estrutura da SPA |
| **CSS3** | Design System com variaveis nativas, Grid, Flexbox, animacoes |
| **JavaScript ES6+** | Logica da aplicacao, modulos, template literals, desestruturacao |
| **Firebase App & Realtime Database** | Backend, banco de dados e sincronismo em tempo real |
| **Font Awesome 6.4.0** | Iconografia vetorial |
| **Google Fonts (Inter)** | Tipografia limpa e moderna |

---

## Estrutura do Projeto

```
SupPaciente/
  index.html    Pagina principal (SPA completa com todas as telas e modais)
  style.css     Design System v3.3 (tokens, temas, componentes)
  script.js     Core engine v7.0 (sincronismo Firebase, estados, renderizacao)
  README.md     Documentacao
```

---

## Configuracao e Instalacao

```bash
# Clone o repositorio
git clone https://github.com/casemiro-dev/SupPaciente.git

# Acesse o diretorio
cd SupPaciente
```

1. Abra o arquivo `index.html`
2. Localize o objeto `firebaseConfig` e substitua pelas chaves do seu proprio projeto Firebase
3. Execute a aplicacao via servidor local:

```bash
# Com Python
python -m http.server 8080

# Ou com Node.js
npx serve .

# Ou use a extensao Live Server do VS Code
```

### Configuracoes iniciais

No arquivo `script.js` voce pode ajustar:

| Variavel | Padrao | Descricao |
|---|---|---|
| `ADMIN_PASSWORD` | `"casemiro2026"` | Senha do painel administrativo |
| `MONITOR_PASSWORD` | `null` | Senha dos monitores (`null` = aceita qualquer senha) |
| `HEARTBEAT_INTERVALO` | `25000` | Intervalo do heartbeat do monitor (ms) |
| `HEARTBEAT_EXPIRACAO` | `75000` | Tempo para expiracao de sessao (ms) |
| `CASOS_LIMITE` | `300` | Limite de casos carregados do Firebase |

---

## Projetos Relacionados

| Projeto | Descricao |
|---|---|
| [DocBox](https://github.com/casemiro-dev/DocBox) | Registro e copia inteligente de atendimentos |
| [DocBox Pro](https://docbox-pro.vercel.app/) | Plataforma profissional com autenticacao e Supabase |
| [Painel de Scripts](https://casemiro-dev.github.io/Painel-de-Scripts/) | Dashboard de scripts em tempo real |
| [LGPD](https://casemiro-dev.github.io/LGPD/) | Conformidade e transferencia de dados |

---

## Autor

**Casemiro Alves** & Pedro Henrique

[GitHub](https://github.com/casemiro-dev)

---

<div align="center">
  <sub>&copy; 2025-2026 Casemiro Alves. Todos os direitos reservados.</sub>
</div>
