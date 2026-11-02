#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Data Mining PDF to Markdown Extractor
=====================================
Извлекает текстовое содержимое PDF книги в структурированный формат Markdown по главам.
Сохраняет форматирование заголовков, блоков кода (Python), списков, сносок и советов.

Использование:
    python extract_pdf_to_markdown.py
    python extract_pdf_to_markdown.py --input "Data Mining.pdf" --output-dir "markdown_chapters" --combine
"""

import os
import sys
import re
import time
import argparse
from pathlib import Path
from typing import List, Dict, Any, Optional

try:
    import pymupdf  # PyMuPDF
except ImportError:
    print("Ошибка: библиотека PyMuPDF (pymupdf) не установлена.")
    print("Установите ее командой: pip install pymupdf")
    sys.exit(1)


def clean_hyphens(text: str) -> str:
    """Удаляет мягкие переносы (soft hyphens) и восстанавливает разорванные слова."""
    text = text.replace('\xad\n', '')
    text = text.replace('\xad', '')
    return text


def sanitize_filename(name: str) -> str:
    """Создает безопасное и информативное имя файла из заголовка главы."""
    # Удаляем недопустимые символы
    name = re.sub(r'[\\/*?:"<>|.,!]', '', name)
    name = re.sub(r'\s+', '_', name.strip())
    # Ограничиваем длину (макс 6-7 слов)
    parts = name.split('_')
    if len(parts) > 7:
        name = '_'.join(parts[:7])
    return name


def is_running_header(block: Dict[str, Any], page_num: int) -> bool:
    """Проверяет, является ли блок верхним колонтитулом со страницей."""
    bbox = block.get('bbox', (0, 0, 0, 0))
    y0, y1 = bbox[1], bbox[3]
    if y0 > 45:
        return False
    
    lines = block.get('lines', [])
    raw_text = ''.join(''.join(s['text'] for s in l['spans']) for l in lines).strip()
    if not raw_text:
        return True
    
    line_parts = [lp.strip() for lp in raw_text.split('\n') if lp.strip()]
    has_num = any(re.match(r'^\d+$', lp) or re.search(r'\b\d{1,3}\b', lp) for lp in line_parts)
    if has_num and y1 < 45:
        return True
    
    # Колонтитулы без номеров на самом верху страницы
    if y1 < 38 and len(raw_text) < 60:
        return True
        
    return False


def normalize_code_quotes(code_text: str) -> str:
    """Заменяет типографские кавычки в коде на стандартные ASCII кавычки."""
    replacements = {
        '’': "'", '‘': "'", '`': "'",
        '“': '"', '”': '"', '«': '"', '»': '"',
        '–': '-', '—': '-',
    }
    for orig, rep in replacements.items():
        code_text = code_text.replace(orig, rep)
    return code_text


class PDFMarkdownExtractor:
    def __init__(self, pdf_path: str, output_dir: str = "markdown_chapters", include_frontmatter: bool = True):
        self.pdf_path = Path(pdf_path).resolve()
        if not self.pdf_path.exists():
            raise FileNotFoundError(f"Файл не найден: {self.pdf_path}")
        
        self.output_dir = Path(output_dir).resolve()
        self.include_frontmatter = include_frontmatter
        self.doc = pymupdf.open(str(self.pdf_path))
        self.total_pages = len(self.doc)
        self.toc = self.doc.get_toc()

    def discover_chapters(self) -> List[Dict[str, Any]]:
        """
        Анализирует оглавление документа и формирует список глав
        с диапазонами страниц [start_page, end_page] (1-индексированные).
        """
        items = []
        for item in self.toc:
            lvl, title, pno = item
            title_clean = title.strip()
            if lvl == 1 or (lvl == 2 and any(kw in title_clean for kw in ['Глава', 'Вступление', 'Приложение', 'Chapter', 'Appendix'])):
                items.append((lvl, title_clean, pno))

        chapters = []
        if items and items[0][2] > 1:
            chapters.append({
                'title': 'Титул и вводные данные',
                'start_page': 1,
                'end_page': items[0][2] - 1,
                'slug': '00_Титул_и_вводные_данные'
            })

        i = 0
        idx = len(chapters)
        while i < len(items):
            lvl, title, pno = items[i]
            is_part = bool(re.match(r'^ЧАСТЬ\s+[IVX]+', title, re.IGNORECASE))
            if is_part and i + 1 < len(items) and items[i + 1][2] <= pno + 2:
                next_lvl, next_title, next_pno = items[i + 1]
                comb_title = f"{title}. {next_title}"
                start_p = pno
                end_p = items[i + 2][2] - 1 if i + 2 < len(items) else self.total_pages
                
                clean_target = next_title.split(':')[0] if ':' in next_title else next_title
                slug_base = sanitize_filename(clean_target)
                chapters.append({
                    'title': comb_title,
                    'start_page': start_p,
                    'end_page': end_p,
                    'slug': f"{idx:02d}_{slug_base}"
                })
                idx += 1
                i += 2
                continue

            start_p = pno
            end_p = items[i + 1][2] - 1 if i + 1 < len(items) else self.total_pages
            
            clean_target = title.split(':')[0] if ':' in title else title
            slug_base = sanitize_filename(clean_target)
            chapters.append({
                'title': title,
                'start_page': start_p,
                'end_page': end_p,
                'slug': f"{idx:02d}_{slug_base}"
            })
            idx += 1
            i += 1

        if not chapters:
            step = 30
            for p in range(1, self.total_pages + 1, step):
                ch_num = (p // step) + 1
                end_p = min(p + step - 1, self.total_pages)
                chapters.append({
                    'title': f'Раздел {ch_num} (страницы {p}-{end_p})',
                    'start_page': p,
                    'end_page': end_p,
                    'slug': f"{ch_num:02d}_Раздел_{p}_{end_p}"
                })

        return chapters

    def extract_page_markdown(self, pno: int, is_chapter_start: bool = False, chapter_title: str = "") -> List[Dict[str, Any]]:
        """
        Извлекает форматированные элементы одной страницы (0-индексированной).
        """
        page = self.doc[pno]
        dict_data = page.get_text('dict', flags=0)
        blocks = dict_data.get('blocks', [])
        page_elements = []

        # Ключевые слова из заголовка главы для фильтрации дублирующих названий на первой странице
        title_keywords = set(re.findall(r'\b\w{4,}\b', chapter_title.lower())) if is_chapter_start else set()

        for b in blocks:
            if 'lines' not in b:
                continue

            # Фильтрация колонтитулов
            if is_running_header(b, pno + 1):
                continue

            lines = b['lines']
            block_lines = []
            is_consolas = True
            has_tahoma_bold = False
            max_size = 0.0

            for l in lines:
                l_text = ''.join(s['text'] for s in l['spans'])
                block_lines.append(l_text)
                for s in l['spans']:
                    font = s['font']
                    size = s['size']
                    if 'Consolas' not in font:
                        is_consolas = False
                    if 'Tahoma-Bold' in font:
                        has_tahoma_bold = True
                    if size > max_size:
                        max_size = size

            full_text = clean_hyphens('\n'.join(block_lines)).strip()
            if not full_text:
                continue

            y0, y1 = b['bbox'][1], b['bbox'][3]

            # На первой странице главы подавляем дублирующий крупный заголовок и номер главы
            if is_chapter_start and y0 < 170:
                # Одиночный номер главы (например, "1", "5", "Глава 1")
                if re.match(r'^(\d+|Глава\s+\d+|Приложение\s+[А-Я])\s*$', full_text, re.IGNORECASE):
                    continue
                # Блок содержит слова из заголовка главы
                block_words = set(re.findall(r'\b\w{4,}\b', full_text.lower()))
                if title_keywords and len(block_words & title_keywords) >= 2:
                    continue

            # 1. Блок программного кода
            if is_consolas:
                code_text = normalize_code_quotes('\n'.join(block_lines))
                page_elements.append({
                    'type': 'code',
                    'text': code_text
                })
                continue

            # 2. Пример (Пример X.Y.)
            ex_match = re.match(r'^(Пример\s+\d+\.\d+\.?\s*.*)', full_text)
            if ex_match:
                page_elements.append({
                    'type': 'example_heading',
                    'text': ex_match.group(1).strip()
                })
                continue

            # 3. Подпись к рисунку (Рис. X.Y.)
            fig_match = re.match(r'^(Рис\.\s+[П\d]+\.\d+\.?\s*.*)', full_text)
            if fig_match:
                caption = ' '.join(full_text.split())
                page_elements.append({
                    'type': 'figure',
                    'text': caption
                })
                continue

            # 4. Блок совета / предупреждения (СОВЕТ:, ВНИМАНИЕ:)
            callout_match = re.match(r'^(СОВЕТ|ВНИМАНИЕ|ПРИМЕЧАНИЕ):\s*(.*)', full_text, re.IGNORECASE)
            if callout_match:
                kind = callout_match.group(1).upper()
                rest = callout_match.group(2).strip()
                page_elements.append({
                    'type': 'callout_header',
                    'kind': kind,
                    'text': rest
                })
                continue

            # 5. Нумерованный заголовок раздела (1.1., 1.3.1., etc.)
            sec_match = re.match(r'^(\d+\.\d+(\.\d+)?\.?)\s+(.+)', full_text)
            if sec_match and (has_tahoma_bold or max_size >= 11):
                sec_num = sec_match.group(1).rstrip('.')
                dots = sec_num.count('.')
                hlvl = min(5, dots + 2)  # 1.1 -> ##, 1.3.1 -> ###
                page_elements.append({
                    'type': 'heading',
                    'level': hlvl,
                    'text': full_text
                })
                continue

            # 6. Главный заголовок главы/части
            ch_match = re.match(r'^(Глава\s+\d+|ЧАСТЬ\s+[IVX]+|Приложение\s+[А-Я])\.?\s*(.*)', full_text, re.IGNORECASE)
            if ch_match:
                page_elements.append({
                    'type': 'heading',
                    'level': 1,
                    'text': full_text
                })
                continue

            # 7. Заголовок по шрифту Tahoma-Bold
            if has_tahoma_bold and max_size >= 13 and len(full_text) < 140 and not full_text.endswith('.'):
                hlvl = 2 if max_size >= 16 else 3
                page_elements.append({
                    'type': 'heading',
                    'level': hlvl,
                    'text': full_text
                })
                continue

            # 8. Элемент списка (начинается с О, •, -, *)
            if re.match(r'^[О•\-*]\s+', full_text):
                cleaned_item = re.sub(r'^[О•\-*]\s+', '', full_text)
                cleaned_item = ' '.join(cleaned_item.split())
                page_elements.append({
                    'type': 'list_item',
                    'text': cleaned_item
                })
                continue

            # 9. Сноска внизу страницы
            if y0 > 545 and (re.match(r"^['’\d]+\s*https?://", full_text) or 'http://' in full_text or 'Примеч. пер' in full_text):
                page_elements.append({
                    'type': 'footnote',
                    'text': ' '.join(full_text.split())
                })
                continue

            # 10. Обычный абзац текста
            paragraph = ' '.join(full_text.split())
            page_elements.append({
                'type': 'paragraph',
                'bbox': b['bbox'],
                'text': paragraph
            })

        return page_elements

    def render_chapter_markdown(self, chapter: Dict[str, Any]) -> str:
        """Рендерит Markdown текст для отдельной главы."""
        md_lines = []
        
        # YAML Frontmatter
        if self.include_frontmatter:
            md_lines.append("---")
            md_lines.append(f"title: \"{chapter['title']}\"")
            md_lines.append(f"pages: \"{chapter['start_page']}-{chapter['end_page']}\"")
            md_lines.append(f"source: \"{self.pdf_path.name}\"")
            md_lines.append("---\n")

        # Главный заголовок документа
        md_lines.append(f"# {chapter['title']}\n")

        in_code_block = False
        code_lines = []
        in_callout = False

        def flush_code():
            nonlocal in_code_block, code_lines
            if in_code_block and code_lines:
                joined_code = '\n'.join(code_lines)
                md_lines.append("```python")
                md_lines.append(joined_code)
                md_lines.append("```\n")
                code_lines = []
                in_code_block = False

        start_pno = chapter['start_page'] - 1
        for pno in range(start_pno, chapter['end_page']):
            is_start = (pno == start_pno)
            elements = self.extract_page_markdown(pno, is_chapter_start=is_start, chapter_title=chapter['title'])

            for el in elements:
                el_type = el['type']

                if el_type == 'code':
                    in_code_block = True
                    code_lines.append(el['text'])
                    continue
                else:
                    flush_code()

                if el_type == 'heading':
                    in_callout = False
                    prefix = '#' * el['level']
                    md_lines.append(f"\n{prefix} {el['text']}\n")

                elif el_type == 'example_heading':
                    in_callout = False
                    md_lines.append(f"\n#### {el['text']}\n")

                elif el_type == 'figure':
                    in_callout = False
                    md_lines.append(f"\n*{el['text']}*\n")

                elif el_type == 'callout_header':
                    kind = el['kind']
                    alert_type = "TIP" if "СОВЕТ" in kind else ("WARNING" if "ВНИМ" in kind else "NOTE")
                    md_lines.append(f"\n> [!{alert_type}]")
                    md_lines.append(f"> **{kind}:** {el['text']}\n")
                    in_callout = True

                elif el_type == 'list_item':
                    in_callout = False
                    md_lines.append(f"- {el['text']}")

                elif el_type == 'footnote':
                    in_callout = False
                    md_lines.append(f"\n> *Сноска:* {el['text']}")

                elif el_type == 'paragraph':
                    text = el['text']
                    # Присоединение переносов строк к списку
                    if md_lines and md_lines[-1].startswith("- ") and el.get('bbox', [0])[0] > 30 and len(text) < 140 and not text.endswith('.'):
                        md_lines[-1] += f" {text}"
                        continue

                    if in_callout:
                        md_lines.append(f"> {text}\n")
                        in_callout = False
                    else:
                        md_lines.append(f"\n{text}\n")

        flush_code()

        cleaned_content = re.sub(r'\n{3,}', '\n\n', '\n'.join(md_lines))
        return cleaned_content.strip() + '\n'

    def extract_all(self, combine: bool = False, quiet: bool = False) -> Dict[str, Any]:
        """
        Извлекает все главы книги, сохраняет их в output_dir,
        генерирует INDEX.md и при флаге combine собирает полный файл.
        """
        self.output_dir.mkdir(parents=True, exist_ok=True)
        chapters = self.discover_chapters()

        if not quiet:
            print("=" * 70)
            print(f"Извлечение PDF: {self.pdf_path.name} ({self.total_pages} стр.)")
            print(f"Каталог сохранения: {self.output_dir}")
            print(f"Обнаружено разделов/глав: {len(chapters)}")
            print("=" * 70)

        stats = []
        combined_markdown = []

        start_time = time.time()

        for idx, ch in enumerate(chapters, 1):
            t_ch_start = time.time()
            md_content = self.render_chapter_markdown(ch)
            
            filename = f"{ch['slug']}.md"
            file_path = self.output_dir / filename
            file_path.write_text(md_content, encoding='utf-8')

            words = len(re.findall(r'\b\w+\b', md_content))
            chars = len(md_content)
            lines = len(md_content.splitlines())
            ch_time = time.time() - t_ch_start

            stats.append({
                'index': idx,
                'title': ch['title'],
                'pages': f"{ch['start_page']}-{ch['end_page']}",
                'filename': filename,
                'words': words,
                'chars': chars,
                'lines': lines,
                'time': ch_time
            })

            if not quiet:
                print(f"[{idx:02d}/{len(chapters):02d}] {ch['title'][:45]:<45} "
                      f"(стр. {ch['start_page']:3d}-{ch['end_page']:3d}) -> {words:5d} слов ({ch_time:.2f}s)")

            if combine:
                combined_markdown.append(f"\n\n<!-- PAGE BREAK: Chapter {idx} -->\n\n")
                combined_markdown.append(md_content)

        index_path = self.output_dir / "INDEX.md"
        index_content = self.generate_index(stats)
        index_path.write_text(index_content, encoding='utf-8')

        if combine:
            combined_file = self.output_dir / f"{self.pdf_path.stem}_Full.md"
            combined_header = [
                f"# {self.pdf_path.stem} (Полная версия)",
                f"*Всего страниц:* {self.total_pages} | *Всего глав:* {len(chapters)}",
                f"*Дата извлечения:* {time.strftime('%Y-%m-%d %H:%M:%S')}",
                "\n---\n"
            ]
            full_text = '\n'.join(combined_header) + ''.join(combined_markdown)
            combined_file.write_text(full_text, encoding='utf-8')
            if not quiet:
                print(f"\n[OK] Объединенный файл создан: {combined_file.name}")

        total_time = time.time() - start_time
        total_words = sum(s['words'] for s in stats)

        if not quiet:
            print("=" * 70)
            print(f"Готово! Извлечено {len(chapters)} глав, {total_words:,} слов за {total_time:.2f} сек.")
            print(f"Индекс оглавления сохранен в: {index_path.name}")
            print("=" * 70)

        return {
            'chapters_count': len(chapters),
            'total_words': total_words,
            'total_time': total_time,
            'stats': stats,
            'output_dir': str(self.output_dir)
        }

    def generate_index(self, stats: List[Dict[str, Any]]) -> str:
        """Генерирует Markdown оглавление со ссылками на главы и статистикой."""
        lines = [
            f"# Оглавление: {self.pdf_path.stem}",
            "",
            f"- **Исходный документ:** `{self.pdf_path.name}`",
            f"- **Количество страниц в PDF:** {self.total_pages}",
            f"- **Всего извлечено глав:** {len(stats)}",
            f"- **Всего слов:** {sum(s['words'] for s in stats):,}",
            f"- **Дата формирования:** {time.strftime('%Y-%m-%d %H:%M:%S')}",
            "",
            "## Главы и разделы",
            "",
            "| № | Раздел / Глава | Страницы PDF | Файл Markdown | Слов |",
            "|---|---|---|---|---:|"
        ]

        for s in stats:
            link = f"[{s['filename']}](./{s['filename']})"
            lines.append(f"| {s['index']:02d} | {s['title']} | {s['pages']} | {link} | {s['words']:,} |")

        lines.extend([
            "",
            "## Инструкция по использованию для анализа",
            "",
            "1. **Анализ отдельной главы**: откройте соответствующий `.md` файл.",
            "2. **Поиск по коду**: примеры кода на Python оформлены в стандартные блоки ```python ... ```.",
            "3. **Семантический поиск и RAG**: файлы оптимизированы для векторных баз данных (удалены колонтитулы, сшиты разорванные переносы слов).",
            "4. **Советы и сноски**: полезные рекомендации выделены блоками `> [!TIP]` и `> *Сноска:*`."
        ])

        return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Извлечение текстового содержимого PDF книги в Markdown по главам."
    )
    parser.add_argument(
        "-i", "--input",
        default="Data Mining.pdf",
        help="Путь к исходному PDF файлу (по умолчанию: 'Data Mining.pdf')"
    )
    parser.add_argument(
        "-o", "--output-dir",
        default="markdown_chapters",
        help="Каталог для сохранения файлов Markdown (по умолчанию: 'markdown_chapters')"
    )
    parser.add_argument(
        "-c", "--combine",
        action="store_true",
        help="Также создать один объединенный файл со всеми главами"
    )
    parser.add_argument(
        "-q", "--quiet",
        action="store_true",
        help="Тихий режим без вывода подробного прогресса"
    )
    parser.add_argument(
        "--no-frontmatter",
        action="store_true",
        help="Не добавлять метаданные YAML в начало файлов"
    )

    args = parser.parse_args()

    input_file = Path(args.input)
    if not input_file.exists():
        script_dir = Path(__file__).parent
        alt_path = script_dir / args.input
        if alt_path.exists():
            input_file = alt_path
        else:
            print(f"Ошибка: PDF файл не найден по пути: {args.input}")
            sys.exit(1)

    extractor = PDFMarkdownExtractor(
        pdf_path=str(input_file),
        output_dir=args.output_dir,
        include_frontmatter=not args.no_frontmatter
    )

    extractor.extract_all(combine=args.combine, quiet=args.quiet)


if __name__ == '__main__':
    main()
