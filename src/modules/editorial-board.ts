/**
 * Editorial Board Formatter Module
 * Reads raw text copied from the CMS website and formats it into an
 * alphabetically sorted list in "First Last, University" format.
 */

export interface BoardMember {
  name: string;
  university: string;
}

const SECTION_HEADERS = new Set([
  'Scholarship and Research',
  'Music Business-Industry',
  'Forums',
  'Performances, Lectures, Lecture-Recitals, Training',
]);

export function parseMembers(text: string): BoardMember[] {
  const members: BoardMember[] = [];
  const lines = text.split(/\r?\n/).map(line => line.trim());

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines and section headers
    if (!line || SECTION_HEADERS.has(line)) {
      i++;
      continue;
    }

    // Strip term years like "(2022-2025)" or "(2020-2023)"
    let name = line.replace(/\s*\(\d{4}-\d{4}\)\s*/g, '').trim();

    // Strip forum specialty suffix after a comma, e.g. "Andrew Adams, Performance"
    const nameParts = name.split(',');
    if (nameParts.length > 1) {
      name = nameParts[0].trim();
    }

    // The next non-blank line should be the university
    let j = i + 1;
    while (j < lines.length && !lines[j]) {
      j++;
    }

    if (j < lines.length && !SECTION_HEADERS.has(lines[j])) {
      const university = lines[j].trim();
      members.push({ name, university });
      i = j + 1;
    } else {
      i++;
    }
  }

  return members;
}

export function lastNameKey(name: string): [string, string] {
  const parts = name.trim().split(/\s+/);
  if (parts.length > 0) {
    const lastName = parts[parts.length - 1].toLowerCase();
    return [lastName, name.toLowerCase()];
  }
  return [name.toLowerCase(), name.toLowerCase()];
}

export function sortMembers(members: BoardMember[]): BoardMember[] {
  return [...members].sort((a, b) => {
    const [lastA, fullA] = lastNameKey(a.name);
    const [lastB, fullB] = lastNameKey(b.name);
    if (lastA !== lastB) {
      return lastA.localeCompare(lastB);
    }
    return fullA.localeCompare(fullB);
  });
}

export function formatMembers(members: BoardMember[], outputFormat: 'text' | 'html' = 'text'): string {
  const sorted = sortMembers(members);
  if (outputFormat === 'html') {
    return `<ul class="editorial-board">\n` +
      sorted.map(m => `  <li><strong>${escapeHtml(m.name)}</strong>, ${escapeHtml(m.university)}</li>`).join('\n') +
      `\n</ul>`;
  }
  return sorted.map(m => `${m.name}, ${m.university}`).join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
