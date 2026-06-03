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
    """Tenta várias estratégias em cascata: manual → auto-gerada → qualquer.
    Compatível com youtube-transcript-api 1.0+."""
    formatter = TextFormatter()
    fallbacks = list(dict.fromkeys([lang_pref, 'pt', 'en', 'es']))

    try:
        transcript_list = _ytt_api.list(video_id)
    except Exception as e:
        return None, f"falha ao listar legendas: {type(e).__name__}"

    # 1) Manual no idioma preferido (e fallbacks)
    for lang in fallbacks:
        try:
            t = transcript_list.find_manually_created_transcript([lang])
            return formatter.format_transcript(t.fetch()), f"manual:{lang}"
        except Exception:
            pass

    # 2) Auto-gerada no idioma preferido (e fallbacks)
    for lang in fallbacks:
        try:
            t = transcript_list.find_generated_transcript([lang])
            return formatter.format_transcript(t.fetch()), f"auto:{lang}"
        except Exception:
            pass

    # 3) Qualquer uma disponível
    for t in transcript_list:
        try:
            kind = 'auto' if t.is_generated else 'manual'
            return formatter.format_transcript(t.fetch()), f"{kind}:{t.language_code}"
        except Exception:
            continue

    return None, "sem legendas disponíveis"


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
    parser.add_argument('--delay',  type=float, default=0.5,
                        help='Pausa entre vídeos em segundos (padrão: 0.5)')
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

    print(f"📥 Baixando transcrições de {len(videos)} vídeos\n"
          f"   Idioma preferido: {args.lang}\n"
          f"   Pausa: {args.delay}s entre vídeos\n"
          f"   Saída:  {output_dir.resolve()}\n")

    manifest = []
    done = failed = 0

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
        f"Total: {len(videos)} | Sucesso: {done} | Falharam: {failed}\n\n"
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
    print(f"✓ {done} transcrições baixadas")
    if failed:
        print(f"✗ {failed} falharam (veja _manifest.txt pra detalhes)")
    print(f"📁 Pasta: {output_dir.resolve()}")
    print(f"📦 ZIP:   {zip_path.resolve()}")


if __name__ == '__main__':
    main()
