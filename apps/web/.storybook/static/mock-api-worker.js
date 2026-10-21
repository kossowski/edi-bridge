const api = new URL(self.location.href).searchParams.get('api')

const apiOrigin = api === null ? null : new URL(api).origin

// MSW broke module fetches of the next story iframe, so only mock API requests reach it.
self.addEventListener('fetch', (event) => {
  if (new URL(event.request.url).origin !== apiOrigin) {
    event.stopImmediatePropagation()
  }
})

self.importScripts('./mockServiceWorker.js')
