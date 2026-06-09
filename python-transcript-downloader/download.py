#!/usr/bin/env python3
"""
YouTube Transcript Downloader
─────────────────────────────────────────────────────────────
Lê um JSON exportado do YouTube Extractor (com lista de vídeos)
e baixa as transcrições/legendas usando youtube-transcript-api.

Roda LOCAL no seu PC → usa seu IP residencial → YouTube não bloqueia.

Uso:
  python download.py videos.json
  python download.py videos.json --lang pt --delay 1.0
"""

import sys
import json
import argparse
import re
import time
import zipfile
from pathlib import Path
from datetime import datetime

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api.formatters import TextFormatter
except ImportError:
    print("⚠ Biblioteca youtube-transcript-api não está instalada.")
    print("  Rode no terminal:  pip install youtube-transcript-api")
    sys.exit(1)


def sanitize_filename(s, max_len=60):
    """Remove caracteres proibidos em nomes de arquivo no Windows."""
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', '', str(s or ''))
    s = re.sub(r'\s+', '_', s).strip('_')
    return (s[:max_len] or 'video')


_ytt_api = YouTubeTranscriptApi()


def fetch_transcript(video_id, lang_pref):
    """Estratégia: tenta fetch direto com lista de idiomas (1.x API faz
    matching parcial — 'pt' casa com 'pt-BR' etc.). Se falhar, lista
    todas as legendas e pega a primeira que rolar."""
    formatter = TextFormatter()

    # Lista de idiomas preferidos em ordem. Inclui variantes regionais
    # comuns pra garantir matching com canais BR (pt-BR), americanos (en-US) etc.
    langs = list(dict.fromkeys([
        lang_pref, 'pt-BR', 'pt', 'en', 'en-US', 'es', 'es-419',
    ]))

    # 1) Fetch direto — a API 1.x faz fallback automático entre os idiomas
    try:
        fetched = _ytt_api.fetch(video_id, languages=langs)
        return formatter.format_transcript(fetched), f"fetch:{fetched.language_code}"
    except Exception as e:
        last_error = f"{type(e).__name__}: {str(e)[:80]}"

    # 2) Se falhou, lista o que tem disponível e pega qualquer uma
    try:
        transcript_list = _ytt_api.list(video_id)
        for transcript in transcript_list:
            try:
                kind = 'auto' if transcript.is_generated else 'manual'
                return (formatter.format_transcript(transcript.fetch()),
                        f"{kind}:{transcript.language_code}")
            except Exception:
                continue
    except Exception as e:
        return None, f"falha: {type(e).__name__}"

    return None, last_error if last_error else "sem legendas disponíveis"


def main():
    parser = argparse.ArgumentParser(
        description='YouTube Transcript Downloader (local)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemplos:
  python download.py videos.json
  python download.py videos.json --lang en --delay 1.5
  python download.py videos.json --output minhas-transcricoes
""",
    )
    parser.add_argument('json_file', help='Arquivo JSON exportado do app')
    parser.add_argument('--lang',   default='pt', help='Idioma preferido (padrão: pt)')
    parser.add_argument('--output', default='transcricoes', help='Pasta de saída')
    parser.add_argument('--delay',  type=float, default=2.0,
                        help='Pausa entre vídeos em segundos (padrão: 2.0)')
    parser.add_argument('--resume', action='store_true',
                        help='Pula vídeos já baixados (procura por URL no header dos TXTs)')
    args = parser.parse_args()

    json_path = Path(args.json_file)
    if not json_path.exists():
        print(f"✗ Arquivo não encontrado: {json_path}")
        sys.exit(1)

    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    videos = data if isinstance(data, list) else data.get('videos', [])
    if not videos:
        print("✗ Nenhum vídeo no JSON")
        sys.exit(1)

    output_dir = json_path.parent / args.output
    output_dir.mkdir(exist_ok=True)

    # Modo retomar: lê os TXTs existentes e monta um conjunto de IDs já baixados
    already_done = set()
    if args.resume:
        url_re = re.compile(r'watch\?v=([\w-]{6,15})')
        for txt_file in output_dir.glob('*.txt'):
            if txt_file.name.startswith('_') or txt_file.name == 'todas-as-transcricoes.txt':
                continue
            try:
                with open(txt_file, 'r', encoding='utf-8') as f:
                    for _ in range(15):  # lê só o cabeçalho
                        line = f.readline()
                        if not line:
                            break
                        m = url_re.search(line)
                        if m:
                            already_done.add(m.group(1))
                            break
            except Exception:
                continue

    print(f"📥 Baixando transcrições de {len(videos)} vídeos\n"
          f"   Idioma preferido: {args.lang}\n"
          f"   Pausa: {args.delay}s entre vídeos\n"
          f"   Saída:  {output_dir.resolve()}")
    if args.resume:
        print(f"   ↷ Modo retomar: {len(already_done)} vídeos já baixados serão pulados\n")
    else:
        print()

    manifest = []
    done = failed = skipped = 0

    for i, v in enumerate(videos):
        video_id = v.get('ID do Vídeo') or v.get('id')
        if not video_id:
            continue

        title   = v.get('Título')      or v.get('title')   or video_id
        channel = v.get('Canal')       or v.get('channel') or 'canal'
        views   = v.get('Views')       or v.get('views')   or 0
        pubdate = v.get('Publicado em') or ''

        rank  = f"{i+1:03d}"
        fname = f"{rank}_{sanitize_filename(channel, 30)}_{sanitize_filename(title, 60)}.txt"

        print(f"[{rank}/{len(videos):03d}] {channel[:25]:25s} | {title[:50]:50s}", end=' ', flush=True)

        # Modo retomar: pula se já baixou
        if video_id in already_done:
            skipped += 1
            manifest.append(f"↷ {rank}. {channel} | {title} | já baixado")
            print("↷ já baixado, pulando")
            continue

        text, info = fetch_transcript(video_id, args.lang)

        if text:
            header = (
                f"# {title}\n"
                f"# Canal:    {channel}\n"
                f"# URL:      https://youtube.com/watch?v={video_id}\n"
                f"# Publicado: {pubdate}\n"
                f"# Views:    {views:,}\n".replace(',', '.') +
                f"# Fonte:    {info}\n"
                "\n"
                "─────────────────────────────────────────────────────\n\n"
            )
            (output_dir / fname).write_text(header + text, encoding='utf-8')
            done += 1
            manifest.append(f"✓ {rank}. [{info}] {channel} | {title}")
            print(f"✓ {info}")
        else:
            failed += 1
            manifest.append(f"✗ {rank}. {channel} | {title} | {info}")
            print(f"✗ {info}")

        time.sleep(args.delay)

    # Manifest
    (output_dir / '_manifest.txt').write_text(
        f"Transcrições — gerado em {datetime.now():%d/%m/%Y %H:%M:%S}\n"
        f"Idioma preferido: {args.lang}\n"
        f"Total: {len(videos)} | Sucesso: {done} | Falharam: {failed} | Pulados (já existentes): {skipped}\n\n"
        + '\n'.join(manifest),
        encoding='utf-8'
    )

    # Arquivo único concatenado (útil pra colar em LLM)
    if done > 0:
        combined = [f"# Todas as transcrições — {datetime.now():%d/%m/%Y %H:%M:%S}\n"]
        for txt_file in sorted(output_dir.glob('*.txt')):
            if txt_file.name.startswith('_'):
                continue
            combined.append('\n\n══════════════════════════════════════════════════════\n')
            combined.append(txt_file.read_text(encoding='utf-8'))
        (output_dir / 'todas-as-transcricoes.txt').write_text(''.join(combined), encoding='utf-8')

    # ZIP final
    zip_path = json_path.parent / f"transcricoes-{datetime.now():%Y-%m-%d_%H%M}.zip"
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for f in output_dir.rglob('*'):
            if f.is_file():
                zf.write(f, f.relative_to(output_dir.parent))

    print(f"\n{'='*60}")
    print(f"✓ {done} transcrições novas baixadas")
    if skipped:
        print(f"↷ {skipped} já existiam (puladas pelo --resume)")
    if failed:
        print(f"✗ {failed} falharam (veja _manifest.txt pra detalhes)")
        print(f"   Dica: troque de rede (hotspot/VPN) e rode de novo com --resume")
    print(f"📁 Pasta: {output_dir.resolve()}")
    print(f"📦 ZIP:   {zip_path.resolve()}")


if __name__ == '__main__':
    main()
