// About a second at 60 fps: a change shows a few frames after the click; if it never does, the
// wait ends rather than going on forever.
const renderWaitFrames = 60

export function whenRendered(done: () => boolean, then: () => void, frames = renderWaitFrames) {
  requestAnimationFrame(() =>
    done() || frames === 0 ? then() : whenRendered(done, then, frames - 1),
  )
}
