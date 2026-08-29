// La paleta de una cámara: casi todo es negro porque casi todo es la foto.
// Lo único con color es el modo seleccionado, y eso es a propósito — en una
// pantalla donde el contenido lo pone la cámara, el color es lenguaje de
// interfaz y no decoración.

export const theme = {
  bg: '#000000',
  chrome: 'rgba(0,0,0,0.55)',
  text: '#ffffff',
  textDim: 'rgba(255,255,255,0.62)',
  accent: '#ffd166',
  accentInk: '#1a1200',
  surprise: '#c084fc',
  danger: '#ff6b6b',
  hairline: 'rgba(255,255,255,0.18)',
} as const;

// El carrusel entero se dimensiona desde aquí: cambiar el diámetro no debe
// obligar a tocar la geometría del scroll (ver `ModeCarousel`).
export const CHIP = {
  size: 64,
  gap: 14,
  get stride() {
    return this.size + this.gap;
  },
} as const;
