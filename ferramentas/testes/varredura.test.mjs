import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acharEmTexto } from '../varredura.mjs';

// Os exemplos são montados por partes para que este arquivo não seja barrado pela própria varredura.
const cats = (t, termos, numeros) => acharEmTexto(t, termos, numeros).map(([c]) => c);
const BS = '\\';
const AT = '@';

test('barra e-mail, telefone, pasta pessoal, IP e token', () => {
  const t = [
    'ana' + AT + 'empresa.com.br',
    '+' + '55 11 98888-7777',
    'C:' + BS + 'Users' + BS + 'fulano' + BS + 'x',
    '/' + 'Users/fulano/x',
    '203.0.' + '113.9',
    'ghp' + '_' + 'a'.repeat(36),
  ].join(' ');
  assert.deepEqual(new Set(cats(t)), new Set(['e-mail', 'telefone', 'pasta pessoal', 'IP', 'chave/token']));
});

test('deixa passar o que é genérico', () => {
  const t = 'Maestro <maestro' + AT + 'users.noreply.github.com> em 127.0.0.1, pasta C:' + BS + 'Users' + BS + '<voce>, versão 1.2.3';
  assert.deepEqual(cats(t), []);
});

test('termos privados: palavra inteira, "=" diferencia maiúscula', () => {
  assert.deepEqual(cats('Proposta da Padaria Aurora', ['Padaria Aurora']), ['termo privado']);
  assert.deepEqual(cats('auroras boreais', ['Aurora']), []);
  assert.deepEqual(cats('as rosas do jardim', ['=Rosas']), []);
  assert.deepEqual(cats('Escola Rosas', ['=Rosas']), ['termo privado']);
});

test('número privado mesmo formatado de outro jeito', () => {
  assert.ok(cats('ligue (11) 3333-4444', [], ['11' + '33334444']).includes('número privado'));
});
