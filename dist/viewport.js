/** Keep a zoomed image within the viewing area while allowing hidden edges to be reached. */
export function constrainPan(scale, imageWidth, imageHeight, viewportWidth, viewportHeight, x, y) {
  const limitX = Math.max(0, (imageWidth * scale - viewportWidth) / 2);
  const limitY = Math.max(0, (imageHeight * scale - viewportHeight) / 2);
  return {
    x: limitX ? Math.max(-limitX, Math.min(limitX, x)) : 0,
    y: limitY ? Math.max(-limitY, Math.min(limitY, y)) : 0
  };
}
