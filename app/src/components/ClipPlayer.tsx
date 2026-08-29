// El reproductor. Su única responsabilidad interesante: que el relevo de la
// foto al vídeo NO SE VEA.
//
// Es lo que vende la feature entera. El primer fotograma del clip es la foto
// —eso lo garantiza el servidor mandándola como `image_url`—, así que si la
// foto sigue debajo y el vídeo aparece encima ya decodificado, lo que ve el
// usuario es su propia foto empezando a moverse. Un fundido a negro de 300 ms
// en medio rompe exactamente esa ilusión, y es lo que pasa por defecto: el
// decodificador tarda, y `VideoView` pinta negro mientras tanto.
//
// De ahí las dos capas: `Image` abajo siempre, `VideoView` encima con
// `opacity: 0` hasta que el estado del reproductor dice `readyToPlay`.

import React, { useEffect, useRef, useState } from 'react';
import { View, Image, Pressable, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEventListener } from 'expo';
import { theme } from '../theme';

export const ClipPlayer: React.FC<{
  url: string;
  /** la foto de partida: se ve debajo hasta que el decodificador está listo */
  posterUri: string;
  /** el sonido lo genera el modelo en la misma pasada; arranca apagado */
  muted?: boolean;
  onToggleMute?: () => void;
}> = ({ url, posterUri, muted = true, onToggleMute }) => {
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const started = useRef(false);

  const player: VideoPlayer = useVideoPlayer(url, (p) => {
    p.muted = muted;
    // En bucle: son cinco segundos. Pararse en el último fotograma obliga a
    // tocar para volver a ver algo que dura menos que la decisión de tocarlo.
    p.loop = true;
  });

  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'readyToPlay') setReady(true);
  });

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  // Arranca solo, una vez. Aquí sí: el usuario acaba de pedir explícitamente
  // este vídeo y está mirando la pantalla. (En un lector de libros la decisión
  // correcta es la contraria, y por eso Ridio no lo hace.)
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    player.play();
    setPlaying(true);
  }, [ready, player]);

  const toggle = () => {
    if (!ready) return;
    if (playing) player.pause();
    else player.play();
    setPlaying(!playing);
  };

  return (
    <Pressable onPress={toggle} style={StyleSheet.absoluteFill} accessibilityRole="button">
      <Image source={{ uri: posterUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <VideoView
        player={player}
        style={[StyleSheet.absoluteFill, { opacity: ready ? 1 : 0 }]}
        contentFit="cover"
        nativeControls={false}
      />
      {!ready && (
        <View style={styles.center}>
          <ActivityIndicator color={theme.text} />
        </View>
      )}
      {ready && !playing && (
        <View style={styles.center} pointerEvents="none">
          <View style={styles.playBadge}>
            <Text style={styles.playGlyph}>▶</Text>
          </View>
        </View>
      )}
      {!!onToggleMute && ready && (
        <Pressable onPress={onToggleMute} style={styles.mute} accessibilityRole="button" accessibilityLabel="Sonido">
          <Text style={styles.muteGlyph}>{muted ? '🔇' : '🔊'}</Text>
        </Pressable>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  playBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: { color: theme.text, fontSize: 24, marginLeft: 4 },
  mute: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.chrome,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteGlyph: { fontSize: 18 },
});
