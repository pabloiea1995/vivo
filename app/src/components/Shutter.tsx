// El botón. Uno solo, y cambia de significado según dónde estés:
//
//   cámara  → dispara
//   elegir  → aplica el modo del centro
//   vídeo   → vuelve a la cámara
//
// Es deliberado que sea el mismo botón en el mismo sitio. En una cámara el
// pulgar no debería tener que buscar: la posición es memoria muscular, y un
// segundo botón primario en la misma fila obliga a leer antes de tocar.

import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { theme } from '../theme';

export type ShutterKind = 'shoot' | 'apply' | 'again';

const RING = 76;
const CORE = 62;

export const Shutter: React.FC<{
  kind: ShutterKind;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  label?: string;
}> = ({ kind, onPress, busy, disabled, label }) => {
  const blocked = !!busy || !!disabled;
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        disabled={blocked}
        accessibilityRole="button"
        accessibilityLabel={label || (kind === 'shoot' ? 'Disparar' : kind === 'apply' ? 'Animar' : 'Otra foto')}
        style={({ pressed }) => [styles.ring, pressed && !blocked && { transform: [{ scale: 0.94 }] }]}
      >
        <View
          style={[
            styles.core,
            kind === 'apply' && { backgroundColor: theme.accent },
            kind === 'again' && styles.hollow,
            blocked && { opacity: 0.55 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={kind === 'apply' ? theme.accentInk : theme.text} />
          ) : kind === 'apply' ? (
            // el triángulo de "reproducir": lo que va a salir de aquí es vídeo
            <Text style={[styles.glyph, { color: theme.accentInk }]}>▶</Text>
          ) : kind === 'again' ? (
            <Text style={styles.glyph}>↺</Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: {
    width: CORE,
    height: CORE,
    borderRadius: CORE / 2,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hollow: { backgroundColor: 'rgba(255,255,255,0.18)' },
  glyph: { fontSize: 22, color: theme.text, fontWeight: '700' },
});
