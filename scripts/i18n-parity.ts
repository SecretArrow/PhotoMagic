import { dictionaries } from '../src/i18n/dictionaries';
const en = Object.keys(dictionaries.en);
const id = Object.keys(dictionaries.id);
const enSet = new Set(en), idSet = new Set(id);
console.log('en keys:', en.length, '| id keys:', id.length);
console.log('missing in id:', JSON.stringify(en.filter(k => !idSet.has(k))));
console.log('missing in en:', JSON.stringify(id.filter(k => !enSet.has(k))));
