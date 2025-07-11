import { serve } from '@hono/node-server'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import type { ServerType } from '@hono/node-server/dist/types'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { WSMessageReceive } from 'hono/ws'
import { WebSocket } from 'ws'
import { createNodeWebSocket } from '.'

describe('WebSocket helper', () => {
  let app: Hono
  let server: ServerType
  let injectWebSocket: ReturnType<typeof createNodeWebSocket>['injectWebSocket']
  let upgradeWebSocket: ReturnType<typeof createNodeWebSocket>['upgradeWebSocket']
  let wss: ReturnType<typeof createNodeWebSocket>['wss']

  beforeEach(async () => {
    app = new Hono()
    ;({ injectWebSocket, upgradeWebSocket, wss } = createNodeWebSocket({ app }))

    server = await new Promise<ServerType>((resolve) => {
      const server = serve({ fetch: app.fetch, port: 3030 }, () => {
        resolve(server)
      })
    })
    injectWebSocket(server)
  })

  afterEach(() => {
    server.close()
  })

  it('Should be inited WebSocket Context even if upgrading process is asynchronous', async () => {
    const mainPromise = new Promise<boolean>((resolve) =>
      app.get(
        '/',
        upgradeWebSocket(
          () =>
            new Promise((resolveWS) =>
              setTimeout(() => {
                resolveWS({
                  onOpen() {
                    resolve(true)
                  },
                })
              }, 100)
            )
        )
      )
    )

    new WebSocket('ws://localhost:3030/')

    expect(await mainPromise).toBe(true)
  })

  it('Should be rejected if upgradeWebSocket is not used', async () => {
    app.get('/', (c) => c.body(''))

    {
      const ws = new WebSocket('ws://localhost:3030/')
      const mainPromise = new Promise<boolean>((resolve) => {
        ws.onerror = () => {
          resolve(true)
        }
        ws.onopen = () => {
          resolve(false)
        }
      })

      expect(await mainPromise).toBe(true)
    }

    {
      //also should rejected on fallback
      const ws = new WebSocket('ws://localhost:3030/notFound')
      const mainPromise = new Promise<boolean>((resolve) => {
        ws.onerror = () => {
          resolve(true)
        }
        ws.onopen = () => {
          resolve(false)
        }
      })

      expect(await mainPromise).toBe(true)
    }
  })

  it('Should be able to connect', async () => {
    const mainPromise = new Promise<boolean>((resolve) =>
      app.get(
        '/',
        upgradeWebSocket(() => ({
          onOpen() {
            resolve(true)
          },
        }))
      )
    )

    new WebSocket('ws://localhost:3030/')

    expect(await mainPromise).toBe(true)
  })

  it('Should be able to send and receive messages', async () => {
    const mainPromise = new Promise((resolve) =>
      app.get(
        '/',
        upgradeWebSocket(() => ({
          onMessage(data) {
            resolve(data.data)
          },
        }))
      )
    )

    const ws = new WebSocket('ws://localhost:3030/')
    await new Promise<void>((resolve) => ws.on('open', resolve))
    ws.send('Hello')

    expect(await mainPromise).toBe('Hello')
  })

  it('Should handle multiple concurrent connections', async () => {
    const connectionCount = 5
    let openConnections = 0
    const messages: string[] = []

    app.get(
      '/',
      upgradeWebSocket(() => ({
        onOpen() {
          openConnections++
        },
        onMessage(data, ws) {
          messages.push(data.data as string)
          ws.send(data.data as string)
        },
      }))
    )

    const connections = await Promise.all(
      Array(connectionCount)
        .fill(null)
        .map(async () => {
          const ws = new WebSocket('ws://localhost:3030/')
          await new Promise<void>((resolve) => ws.on('open', resolve))
          return ws
        })
    )

    expect(openConnections).toBe(connectionCount)

    await Promise.all(
      connections.map((ws, index) => {
        return new Promise<void>((resolve) => {
          ws.send(`Hello from connection ${index + 1}`)
          ws.on('message', () => {
            resolve()
          })
        })
      })
    )

    expect(messages.length).toBe(connectionCount)
    messages.forEach((msg, index) => {
      expect(msg).toBe(`Hello from connection ${index + 1}`)
    })

    connections.forEach((ws) => {
      ws.close()
    })
  })

  it('CloseEvent should be executed without crash', async () => {
    const testCode = 3001
    const testReason = 'Test!'
    app.get(
      '/',
      upgradeWebSocket(() => ({
        onClose(event) {
          expect(event.code).toBe(testCode)
          expect(event.reason).toBe(testReason)
        },
      }))
    )

    const ws = new WebSocket('ws://localhost:3030/')
    await new Promise<void>((resolve) => ws.on('open', resolve))
    ws.close(testCode, testReason)
  })

  it('Should be able to send and receive binary content with good length', async () => {
    const mainPromise = new Promise<WSMessageReceive>((resolve) =>
      app.get(
        '/',
        upgradeWebSocket(() => ({
          onMessage(data) {
            resolve(data.data)
          },
        }))
      )
    )

    const binaryData = new Uint8Array(Array.from({ length: 16 }).map((_, i) => i ** 2))

    const ws = new WebSocket('ws://localhost:3030/')
    await new Promise<void>((resolve) => ws.on('open', resolve))
    ws.send(binaryData)

    const receivedMessage = await mainPromise
    expect(receivedMessage).toBeInstanceOf(ArrayBuffer)
    expect((receivedMessage as ArrayBuffer).byteLength).toBe(binaryData.length)

    binaryData.forEach((val, idx) => {
      expect(new Uint8Array(receivedMessage as ArrayBuffer)[idx]).toBe(val)
    })
  })

  describe('Types', () => {
    it('Should not throw a type error with an app with Variables generics', () => {
      const app = new Hono<{
        Variables: {
          foo: string
        }
      }>()
      createNodeWebSocket({ app })
    })
  })

  it('Should client can connect when use cors()', async () => {
    app.use(cors())
    const mainPromise = new Promise<boolean>((resolve) =>
      app.get(
        '/',
        upgradeWebSocket(() => ({
          onOpen() {
            resolve(true)
          },
        }))
      )
    )

    new WebSocket('ws://localhost:3030/')

    expect(await mainPromise).toBe(true)
  })
  it('Should client can connect even if a response has difference', async () => {
    app.use(async (c, next) => {
      c.res = new Response(null, c.res)
      await next()
    })
    const mainPromise = new Promise<boolean>((resolve) =>
      app.get(
        '/',
        upgradeWebSocket(() => ({
          onOpen() {
            resolve(true)
          },
        }))
      )
    )

    new WebSocket('ws://localhost:3030/')

    expect(await mainPromise).toBe(true)
  })

  it('Should not async processes to create events affect message handling', async () => {
    const mainPromise = new Promise<boolean>((resolve) =>
      app.get(
        '/',
        upgradeWebSocket(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          return {
            onMessage() {
              resolve(true)
            },
          }
        })
      )
    )

    const ws = new WebSocket('ws://localhost:3030/')
    ws.onopen = () => {
      ws.send('Hello')
    }

    expect(await mainPromise).toBe(true)
  })

  it('Should return the wss used for the websocket helper', async () => {
    let clientWs: WebSocket | null = null
    const mainPromise = new Promise<void>((resolve) =>
      wss.on('connection', (ws) => {
        clientWs = ws
        resolve()
      })
    )

    app.get(
      '/',
      upgradeWebSocket(() => ({}))
    )
    new WebSocket('ws://localhost:3030/')

    await mainPromise

    expect(clientWs).toBeTruthy()
    expect(wss.clients.size).toBe(1)
  })
})
