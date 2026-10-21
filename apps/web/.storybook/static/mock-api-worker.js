// The Storybook mock worker. Story iframes take turns: one closes while the next loads its modules.
// The MSW worker handles every request of the pages it controls, and a module fetch of the next
// iframe sometimes failed ("Failed to fetch dynamically imported module") or a mocked request went
// unanswered. Only requests to the mock API, named by the `api` query parameter, reach MSW here.
const apiUrl = new URL(self.location.href).searchParams.get('api')

self.addEventListener('fetch', (event) => {
  if (apiUrl === null || !event.request.url.startsWith(apiUrl)) {
    event.stopImmediatePropagation()
  }
})

self.importScripts('./mockServiceWorker.js')
