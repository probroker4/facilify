const LATIN_ACCENTS = /[̀-ͯ]/g;
const JOINERS = /[​-‍⁠﻿]/g;

export function normKey(s: string): string {
  return (s ?? '').normalize('NFKD').replace(LATIN_ACCENTS, '').replace(JOINERS, '').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, '');
}

export function normWords(s: string): string {
  return (s ?? '').normalize('NFKD').replace(LATIN_ACCENTS, '').replace(JOINERS, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
