// fase4-carrera.mjs (tarea 4.9): caso límite de la instancia única (4.1): la
// segunda instancia llega MIENTRAS la primera aún arranca (0/60/150/300 ms
// después). second-instance puede dispararse antes de que exista la ventana o el
// núcleo; la primera debe seguir viva y con su ventana, la segunda salir con 0.
//
//   node test/e2e/fase4-carrera.mjs
import { makeSandbox, cleanSandbox, spawnApp, sleep, win } from './fase4-lib.mjs'
import { spawnSync } from 'node:child_process'
for (const delay of [0, 60, 150, 300]) {
  const sb = makeSandbox('osc-fase4r-')
  const a = spawnApp(sb, { withCdp: false })
  await sleep(delay)
  const b = spawnApp(sb, { withCdp: false })
  const bExit = await new Promise((r) => {
    b.child.once('exit', (c) => r(c))
    setTimeout(() => r('timeout'), 20000)
  })
  await sleep(4000)
  const alive = a.child.exitCode === null
  const info = alive ? win('info', { AppPid: a.child.pid }) : null
  console.log(
    `delay=${delay}ms  B exit=${bExit}  A viva=${alive} visible=${info?.visible} A exit=${a.child.exitCode}`
  )
  if (bExit !== 0 || !alive || !info?.visible) process.exitCode = 1
  if (!alive || /Error|error/.test(a.log())) console.log('LOG A:', a.log().slice(0, 600))
  if (alive) {
    win('close', { AppPid: a.child.pid })
    await sleep(2500)
  }
  if (a.child.exitCode === null)
    spawnSync('taskkill', ['/pid', String(a.child.pid), '/T', '/F'], { stdio: 'ignore' })
  await sleep(800)
  cleanSandbox(sb)
}
