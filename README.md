# 🌊 SupPaciente (v6.0)

> **Sistema Avançado de Gestão de Chamados em Tempo Real, Triagem Integrada e Suporte às PAs.**

O **Teleflow** (também referenciado como *SupPaciente*) é uma aplicação web de alta performance desenvolvida para otimizar fluxos de atendimento, triagem de chamados e monitorização de operadores em tempo real. Utilizando uma arquitetura moderna sem dependências pesadas de frameworks de terceiros, o sistema consome diretamente a API do **Firebase Realtime Database** para garantir sincronização instantânea de estado entre múltiplos perfis de utilizadores (Operadores, Monitores e Administradores).

---

## 🚀 Novidades da Versão 6.0

* **Fim da Limpeza Automática:** Nenhum caso/chamado é apagado por rotinas automáticas. O histórico permanece íntegro até ação deliberada.
* **Aba de Manutenção (Admin):** Nova interface administrativa que permite a limpeza manual e cirúrgica de chamados concluídos por período específicos (*Hoje*, *7 dias*, *30 dias* ou *Tudo*).
* **Exportação Inteligente:** Substituição do antigo formato CSV pela extração nativa em **JSON do Período**, garantindo maior fidelidade e estruturação dos dados analíticos.
* **Sino de Notificações Ativo (Operador):** Sistema de alertas com modal expansível. A dispensa de alertas é persistida localmente via `localStorage`, impedindo sobrecarga e alterações desnecessárias no banco global.
* **Multi-Sessão Resiliente (Monitor):** Suporte completo para abertura em múltiplas abas ou múltiplos computadores em simultâneo. O encerramento de uma sessão ou aba não derruba as demais, graças ao mecanismo inteligente de *Heartbeat* que restabelece o estado online caso haja remoções acidentais.
* **Semântica de Estado Aperfeiçoada:** A antiga nomenclatura "Pausa Técnica" foi atualizada para **"Indisponível"** (sinalizada visualmente a vermelho), melhorando a clareza operacional.
* **Acessibilidade e UX:** Correção de alinhamentos estruturais na tabela de Relatórios e suporte universal à tecla `Enter` para submissão de formulários em todas as telas de autenticação.

---

## 📊 Arquitetura do Sistema e Design

O projeto adota uma filosofia *lean software*, estruturado em três pilares fundamentais de front-end:

1.  **`index.html`**: Ponto de entrada unificado que implementa uma Single Page Application (SPA). As transições de tela são geridas via manipulação de visibilidade de componentes DOM, reduzindo latência e overhead de rede.
2.  **`style.css` (Design System v3.3)**: Arquitetura CSS limpa e robusta fundamentada em *CSS Variables* (Design Tokens). Suporta nativamente **Modo Escuro (Dark Mode)** e **Modo Claro**, além de possuir utilitários de estados (`info`, `success`, `warning`, `danger`) com variantes suaves (*soft fills*) altamente legíveis.
3.  **`script.js`**: Core engine responsável pela reatividade da aplicação, controlo de fluxo de estados locais (`localDB`), validações de sessão (`sessionStorage`) e canais de comunicação persistentes através de WebSockets estruturados pelo SDK do Firebase.

---

## 🛠️ Tecnologias Utilizadas

* **Front-end:** HTML5 Semântico, CSS3 (Variáveis Nativas, Grid e Flexbox)
* **Linguagem:** JavaScript Moderno (ES6+)
* **Realtime Backend & Database:** Firebase App & Realtime Database (SDK v9.23.0 via ESM)
* **Iconografia:** Font Awesome 6.4.0
* **Tipografia:** Inter Font Family (Google Fonts)

---

## ⚙️ Configuração e Instalação
1. Clone este repositório para o seu ambiente local.
2. Abra o ficheiro `index.html` e altere o objeto `firebaseConfig` com as chaves e credenciais da sua própria base de dados do Firebase.
3. Devido à utilização de módulos nativos do JavaScript, a aplicação deve ser executada através de um servidor local. Pode utilizar a extensão **Live Server** do VS Code ou o comando:
   ```bash
   python -m http.server 8080
