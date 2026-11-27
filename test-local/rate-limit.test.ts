// Prueba local del límite de pedidos. Corre: npx ts-node --transpile-only test-local/rate-limit.test.ts
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:x@localhost:5432/x';
process.env.JWT_SECRET = 'secreto-de-prueba';
process.env.RATE_LIMIT_MAX = '5';
process.env.RATE_LIMIT_MAX_AUTH = '8';
process.env.NODE_ENV = 'test';
import jwt from 'jsonwebtoken';
import express from 'express';

let fallas = 0;
const check = (nombre: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'FALLA'} ${nombre} ${extra}`);
  if (!cond) fallas++;
};

async function main() {
  const app = (await import('../src/app')).default;
  const { limiteLogin } = await import('../src/middlewares/rateLimit.middleware');
  const srv = app.listen(0); const port = (srv.address() as any).port;
  const get = async (token?: string) => (await fetch(`http://127.0.0.1:${port}/api/v1/no-existe`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })).status;

  const S = 'secreto-de-prueba';
  const tokA = jwt.sign({ sub: 'userA', empresaId: 'e1', typ: 'access' }, S, { expiresIn: '1h' });
  const tokB = jwt.sign({ sub: 'userB', empresaId: 'e1', typ: 'access' }, S, { expiresIn: '1h' });
  const tokSuper = jwt.sign({ sub: 'superadmin', rol: 'SUPERADMIN' }, S, { expiresIn: '1h' });
  const falso = jwt.sign({ sub: 'userA', empresaId: 'e1', typ: 'access' }, 'otro-secreto');
  const refresh = jwt.sign({ sub: 'userA', typ: 'refresh' }, S, { expiresIn: '1h' });
  const vencido = jwt.sign({ sub: 'userA', empresaId: 'e1', typ: 'access', exp: Math.floor(Date.now()/1000) - 60 }, S);

  const anon = []; for (let i = 0; i < 6; i++) anon.push(await get());
  check('anónimo: 5 pasan, el 6° da 429', anon.slice(0,5).every(s => s !== 429) && anon[5] === 429, JSON.stringify(anon));

  const a = []; for (let i = 0; i < 9; i++) a.push(await get(tokA));
  check('logueado A con la IP ya agotada: 8 pasan, el 9° da 429', a.slice(0,8).every(s => s !== 429) && a[8] === 429, JSON.stringify(a));
  check('logueado B (otro usuario, misma IP) pasa', (await get(tokB)) !== 429);
  check('superadmin pasa', (await get(tokSuper)) !== 429);
  check('token con firma falsa cuenta como anónimo (429)', (await get(falso)) === 429);
  check('refresh token cuenta como anónimo (429)', (await get(refresh)) === 429);
  check('token vencido cuenta como anónimo (429)', (await get(vencido)) === 429);
  srv.close();

  // Login: solo cuentan los intentos fallidos
  const mini = express(); mini.use(express.json());
  mini.post('/login', limiteLogin, (req, res) => { res.status(req.body.ok ? 200 : 401).json({}); });
  const s2 = mini.listen(0); const p2 = (s2.address() as any).port;
  const login = async (ok: boolean) => (await fetch(`http://127.0.0.1:${p2}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok }) })).status;
  const exitos = []; for (let i = 0; i < 15; i++) exitos.push(await login(true));
  check('login: 15 logins exitosos seguidos pasan', exitos.every(s => s === 200), JSON.stringify(exitos));
  const fallidos = []; for (let i = 0; i < 11; i++) fallidos.push(await login(false));
  check('login: 10 fallidos pasan, el 11° da 429', fallidos.slice(0,10).every(s => s === 401) && fallidos[10] === 429, JSON.stringify(fallidos));
  s2.close();

  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTODO OK');
  process.exit(fallas ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
