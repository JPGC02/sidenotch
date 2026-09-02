# SideNotch — uso das suas IAs numa barra lateral do Windows

Versão Windows do conceito do CodeNotch (Mac): uma "notch" fina fixa na borda da tela. Passe o mouse e ela abre mostrando anéis com o uso de **Claude**, **Codex/ChatGPT**, **Cursor** e **Gemini CLI**. Passe o mouse num anel para ver as janelas (sessão 5h, semanal, Opus, ciclo mensal…) e quando reiniciam.

Nada sai da sua máquina além das chamadas às APIs oficiais de cada provedor, usando o login que você já fez nas CLIs.

## Instalar (usuário final)

**Opção A — portátil (pronto):** descompacte `SideNotch-Portable-3.1.0-win64.zip` em qualquer pasta e rode `SideNotch.exe`. Aparece um ícone na bandeja e a notch na borda direita da tela.

**Opção B — instalador .exe (gerar no Windows):**
```bat
cd sidenotch
npm install
npm run dist
```
O instalador sai em `dist\SideNotch-Setup-3.1.0.exe` (requer Node.js 18+; no Windows não precisa de wine).

## Rodar em desenvolvimento
```bat
npm install
npm start
npm test        # testa os parsers das APIs
```

## Como cada provedor é lido

| Provedor | Fonte | O que mostra |
|---|---|---|
| Claude | `%USERPROFILE%\.claude\.credentials.json` (login do Claude Code) → `GET api.anthropic.com/api/oauth/usage` (mesmo endpoint do `/usage`) | Sessão 5h, semanal, Opus, Sonnet |
| Codex | `%USERPROFILE%\.codex\auth.json` (login do Codex CLI) → `GET chatgpt.com/backend-api/wham/usage` (mesmo do `/status`) | Sessão 5h, semanal, créditos, plano |
| Cursor | Cookie `WorkosCursorSessionToken` colado nas configurações → `GET cursor.com/api/usage-summary` | % do plano no ciclo, sob demanda, pool do time |
| Gemini | `%USERPROFILE%\.gemini\oauth_creds.json` (login do Gemini CLI) → `cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` | Cota restante por modelo (pro/flash), reinício diário |
| Antigravity | language server local do IDE (porta + CSRF lidos do processo) → `GetUserStatus` | Cota por modelo (precisa do IDE aberto) |
| OpenRouter | API key → `/api/v1/auth/key` e `/api/v1/credits` | Limite da chave, créditos restantes |
| NVIDIA NIM | API key → `/v1/models` | Valida a chave; a NVIDIA não expõe uso por API |
| OpenCode | arquivos locais `~/.local/share/opencode/storage/message` | Custo e tokens de hoje/mês (sem cota) |

Pré-requisitos: ter feito login pelo menos uma vez em `claude`, `codex login`, `gemini`. Para o Cursor, faça login em cursor.com → F12 → Application → Cookies → copie o valor de `WorkosCursorSessionToken`.

## Aprovações do Claude Code

O SideNotch sobe um servidor local (`127.0.0.1:47321`, só no seu PC, protegido por token) e registra um hook HTTP `PermissionRequest` em `~/.claude/settings.json`. Quando o Claude Code pede permissão — no terminal, VS Code ou Cowork — a notch pulsa em laranja, mostra um cartão com a ferramenta, o comando/arquivo e o projeto, e você decide:

- **Permitir** — libera só esta vez
- **Sempre** — libera e grava a regra "sempre permitir" que o Claude Code sugeriu (o mesmo que a opção do prompt)
- **Negar** — o Claude recebe "Negado pelo usuário no SideNotch"

Também cobre **aprovação de plano** (`ExitPlanMode`: Aprovar / Aprovar + auto / Recusar) e **perguntas do Claude** (`AskUserQuestion`: as opções viram botões na barra).

Sem decisão em 110 s (configurável), o SideNotch devolve resposta vazia e o Claude Code mostra o prompt normal.

Para ativar: Configurações → **Instalar hook no Claude Code** (o botão só adiciona a entrada; o resto do settings.json é preservado). Sessões do Claude Code já abertas precisam ser reiniciadas para ler o hook. Em **auto mode** o Claude não pede permissão, então nada chega à barra.

## Sessões, avisos e alertas

Com os hooks instalados a barra também mostra:
- **Sessões ativas** (ícone de terminal): projeto, modelo, modo, status — trabalhando / esperando você / terminou / erro.
- **Avisos**: "X terminou" (`Stop`), "X está esperando você" (`idle_prompt`), negações do **auto mode** (`PermissionDenied`), limites de uso pausando o Claude. Opcionalmente também como notificação do Windows. Os pedidos de permissão aparecem agrupados por sessão, com cor por sessão.
- **Responder em texto**: nos cartões de plano/permissão, "Dizer o que mudar" / "Responder" envia sua mensagem ao Claude (como recusa com motivo). Nas perguntas, "Outra…" aceita texto livre.
- **Alertas de limite**: aos 80% e 95% (configurável) e quando a janela reinicia.
- **Previsão**: no popover do provedor, "no ritmo atual a janela esgota em X" (calculado a partir das leituras dos últimos 45 min).
- **Histórico**: mini-gráficos das últimas 24 h e pico diário de 7 dias (`%APPDATA%\sidenotch\history.json`).

## Atalhos, não perturbe, widget compacto, arrastar
- **Atalhos globais** (configuráveis, vazios por padrão): abrir/fixar a barra, aprovar/negar o pedido mais antigo.
- **Não perturbe** (bandeja ou ícone do sino): sem som, sem toast, a barra não abre sozinha; o contador continua aparecendo.
- **Notch fechada** pode mostrar pontinhos coloridos (um por provedor) ou o maior % usado.
- **Arrastar**: segure o `⋯` no topo da barra e solte onde quiser — muda de lado/monitor automaticamente e salva a posição.

## Notch no topo (3.0)
Além da barra lateral, uma pastilha no topo do monitor (estilo notch) que expande com abas:
- **Música**: o que está tocando (Spotify, YouTube, Chrome, VLC… via controles de mídia do Windows/SMTC), **capa do álbum**, progresso e prev/play/next.
- **Sistema**: CPU, memória, rede ↓↑ e discos, com mini-gráficos (worker PowerShell `src/winworker.ps1`).
- **Apps**: web apps em janelas próprias com login persistente (ChatGPT, Claude, GitHub… + os seus) e apps instalados do Menu Iniciar (busca, fixar favoritos).
- **Notas**: notas de texto ou **checklists** (tarefas com ✓), autosave; conversão entre os dois modos.
- **Canvas**: quadro infinito — Ctrl+V/arraste imagens, texto, setas, zoom/pan, múltiplos boards, exportar PNG (copia para a área de transferência).
- **Calendário**: faixa da semana + hoje + próximos, a partir de links .ics (Google/Outlook).
Fechada, a pastilha mostra a capa/música, CPU/RAM e o próximo compromisso; aberta, o tamanho se adapta à aba. Configurações → Notch. As configurações ganharam visual novo (acrílico no Windows 11).

## Maestri (Wire)
Integra com o [Maestri Wire](https://www.themaestri.app/pt-br/docs/wire): Configurações → Maestri → código de pareamento (ou senha da aba Manual). A chave pública do host é fixada na primeira conexão (TOFU) e conferida em toda conexão antes de enviar o token. A barra então mostra os terminais do Maestri em **Sessões** (com "Ir ao terminal", "Visto" e envio de prompt), avisa quando um agente **precisa de atenção**, e responde **prompts S/n** com Aprovar/Rejeitar. Consulta o feed a cada 4 s (configurável). Pareie como *Somente leitura* se só quiser os avisos.

## Auto-update
O instalador (NSIS) verifica o GitHub Releases de `JPGC02/sidenotch` a cada 6 h e baixa a nova versão; a bandeja/configurações mostram "Instalar e reiniciar". Para publicar: `git tag v3.1.0 && git push --tags` — o workflow `.github/workflows/release.yml` compila no Windows e publica. O ZIP portátil não se atualiza sozinho.

## Configurações (ícone de engrenagem na barra ou bandeja)
- Lado (esquerda/direita), posição vertical (topo/centro/base), deslocamento em px, monitor
- Largura da notch fechada, intervalo de atualização (padrão 180 s — o endpoint do Claude limita chamadas frequentes)
- Ativar/desativar e ordenar provedores, token/cookie opcionais
- Iniciar com o Windows

Arquivo de configuração: `%APPDATA%\sidenotch\settings.json`.

## Estrutura
```
src/main.js            janela transparente sempre no topo, posicionamento, bandeja, IPC, timer
src/preload.js         ponte segura renderer ↔ main
src/store.js           settings.json
src/approvals.js       servidor HTTP dos hooks (aprovações + eventos/sessões/feed) e instalação dos hooks
src/history.js         histórico de uso, previsão e alertas de limite
src/updater.js         auto-update via GitHub Releases
src/maestri.js         cliente Maestri Wire (pareamento, pin, feed, ações)
src/providers/*.js     um módulo por provedor (fetchUsage + parse)
src/renderer/bar.html  a barra (anéis, hover, popover)
src/renderer/settings.html
test/providers.test.js parsers com payloads reais
test/approvals.test.js protocolo do hook, plano/perguntas, eventos/sessões e instalação
test/history.test.js   alertas, previsão e persistência
test/maestri.test.js   servidor Wire falso: pareamento, pin, feed, atenção, prompts, ações
test/preview-mock.html a barra com dados falsos — abra no navegador para ver o visual
```

## Observações
- Os endpoints de Claude/Codex/Cursor/Gemini não são públicos/documentados (são os mesmos que as CLIs e o CodexBar usam); podem mudar. Cada provedor falha isoladamente e mostra a dica no popover.
- O ZIP portátil foi gerado no Linux, por isso o `SideNotch.exe` usa o ícone padrão do Electron; o build feito no Windows (`npm run dist`) aplica o ícone `build/icon.ico`.
