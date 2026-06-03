# YouTube Transcript Downloader (Python local)

Script local pra baixar transcrições/legendas dos vídeos exportados do
YouTube Extractor.

**Por que rodar local?** O YouTube bloqueia serverless/cloud (Cloudflare etc.)
quando tenta acessar transcrições em escala. Seu PC tem IP residencial — o
YouTube trata como acesso normal.

---

## Setup (uma vez só)

### 1) Instalar Python

Se você ainda não tem Python no seu PC:

1. Vá em https://www.python.org/downloads/windows/
2. Baixe a versão estável (3.11 ou 3.12)
3. **IMPORTANTE**: Na primeira tela do instalador, marque a caixa
   **"Add Python to PATH"** antes de clicar em Install
4. Conclua a instalação

**Verifica** abrindo o PowerShell e digitando:
```
python --version
```
Deve aparecer algo como `Python 3.12.x`.

### 2) Instalar a biblioteca de transcrição

No PowerShell, rode:
```
pip install youtube-transcript-api
```

Aguarde uns 10-20 segundos. Deve terminar com algo tipo
`Successfully installed youtube-transcript-api-X.X.X`.

Pronto — setup feito.

---

## Como usar (toda vez)

### Passo 1: Exportar lista do app

1. Abra https://eqi-research.github.io/youtube-extractor/
2. Aba **Open**, selecione uma lista de canais
3. Garanta que **"ID do Vídeo"** e **"Canal"** estão marcados nos campos
4. Clica **▶ Buscar dados**
5. Quando aparecer a tabela, clica em **📋 JSON pra Python**
6. Salve o arquivo (algo tipo `videos-pra-transcrever-2026-04-28.json`)

### Passo 2: Rodar o script

Abra o PowerShell na pasta `python-transcript-downloader` (onde está o
`download.py`):

```
cd "C:\Users\RenatoSantiagoDeOliv\OneDrive - EQI Investimentos\Área de Trabalho\git_\youtube-extractor\python-transcript-downloader"
```

E rode passando o JSON (substitua pelo caminho onde você salvou):

```
python download.py "C:\Users\...\Downloads\videos-pra-transcrever-2026-04-28.json"
```

Você vai ver algo assim no terminal:
```
📥 Baixando transcrições de 28 vídeos
   Idioma preferido: pt
   Pausa: 0.5s entre vídeos
   Saída:  C:\...\Downloads\transcricoes

[001/028] Canal Influencer A         | Título do vídeo bla bla bla   ✓ manual:pt
[002/028] Canal Influencer B         | Outro título                  ✓ auto:pt
[003/028] Canal Influencer A         | Mais um título                ✗ sem legendas disponíveis
...
```

### Passo 3: Resultado

Na **mesma pasta do JSON**:
- Pasta `transcricoes/` com um `.txt` por vídeo
- Arquivo `_manifest.txt` listando o que funcionou
- Arquivo `todas-as-transcricoes.txt` — tudo concatenado (bom pra colar em ChatGPT/Claude)
- Um **ZIP** com tudo isso pronto pra arquivar

---

## Opções avançadas

```
python download.py videos.json --lang en          # prefere inglês
python download.py videos.json --delay 1.5         # 1.5s entre vídeos (mais seguro)
python download.py videos.json --output transcr   # pasta de saída diferente
```

---

## Troubleshooting

**"python não é reconhecido como um comando"**
→ Você não marcou "Add Python to PATH" na instalação. Reinstala o Python
   marcando essa opção, ou use o caminho completo:
   `C:\Users\SEU_USER\AppData\Local\Programs\Python\Python312\python.exe`

**"ModuleNotFoundError: No module named 'youtube_transcript_api'"**
→ Rode: `pip install youtube-transcript-api`

**"Subtitles are disabled for this video"**
→ Esse vídeo específico desativou legendas. Pulado, é normal.

**"YouTube is blocking requests" / muitos falhando**
→ Aumenta o delay: `python download.py videos.json --delay 2.0`. Se persistir,
   aguarde algumas horas — YouTube pode ter te rate-limitado temporariamente.

**Quero rodar de novo só os que falharam**
→ Por enquanto o script roda tudo. Edita o JSON deixando só os que faltam.
