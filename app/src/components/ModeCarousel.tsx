// El carrusel de modos: filtros de Instagram, pero cada chip lo ha escrito un
// modelo que ha mirado TU foto.
//
// La gramática es la de una cámara y conviene no romperla, porque es la que
// hace que no haya que explicar nada:
//
//  - Se desliza y el chip del centro es el elegido. El centro es la selección;
//    no hay marca de "activo" en otro sitio.
//  - Tocar un chip lo trae al centro. Tocar el que YA está en el centro lo
//    aplica — igual que en Instagram, donde el filtro ya seleccionado se abre.
//  - El disparador de abajo aplica siempre el del centro, así el pulgar puede
//    quedarse donde está.
//
// El detalle que cuesta y se nota: el primer y el último chip tienen que poder
// llegar al centro, así que el ScrollView lleva medio ancho de pantalla de
// relleno a cada lado. Sin eso, el primer modo (el más sutil, el que más se
// usa) es el único que no se puede seleccionar deslizando.

import React, { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { CHIP, theme } from '../theme';
import type { Mode } from '../api/client';

interface Props {
  modes: Mode[];
  index: number;
  onIndexChange: (i: number) => void;
  /** tocar el chip ya centrado */
  onApply: (mode: Mode) => void;
  disabled?: boolean;
  /** el modo que se está generando ahora mismo */
  busyIndex?: number | null;
}

export const ModeCarousel: React.FC<Props> = ({
  modes,
  index,
  onIndexChange,
  onApply,
  disabled,
  busyIndex,
}) => {
  const { width } = useWindowDimensions();
  const pad = Math.max(0, (width - CHIP.size) / 2);
  const ref = useRef<ScrollView>(null);
  // Para no pelearse con el propio scroll del usuario: cuando el índice cambia
  // PORQUE ha deslizado, no hay que volver a mandarlo al centro.
  const settling = useRef(false);

  const scrollTo = useCallback(
    (i: number, animated = true) => {
      settling.current = true;
      ref.current?.scrollTo({ x: i * CHIP.stride, animated });
      // el momentum acaba solo; esto solo cubre el caso sin animación
      setTimeout(() => (settling.current = false), animated ? 350 : 0);
    },
    []
  );

  // Un carrusel nuevo (foto nueva) arranca en el primero, sin animar: animar
  // desde la posición del carrusel anterior enseña los modos de la foto que ya
  // no está.
  useEffect(() => {
    scrollTo(0, false);
  }, [modes, scrollTo]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (settling.current) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / CHIP.stride);
    const clamped = Math.max(0, Math.min(modes.length - 1, i));
    if (clamped !== index) onIndexChange(clamped);
  };

  return (
    <View>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        // el snap es lo que convierte "una fila de botones" en un selector
        snapToInterval={CHIP.stride}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={onScroll}
        scrollEnabled={!disabled}
        contentContainerStyle={{ paddingHorizontal: pad }}
      >
        {modes.map((mode, i) => (
          <Chip
            key={mode.id}
            mode={mode}
            selected={i === index}
            busy={busyIndex === i}
            disabled={!!disabled}
            onPress={() => (i === index ? onApply(mode) : scrollTo(i))}
          />
        ))}
      </ScrollView>
    </View>
  );
};

const Chip: React.FC<{
  mode: Mode;
  selected: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}> = ({ mode, selected, busy, disabled, onPress }) => {
  const ring = mode.surprise ? theme.surprise : theme.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={mode.label}
      style={{ width: CHIP.size, marginRight: CHIP.gap }}
    >
      <View
        style={[
          styles.chip,
          { width: CHIP.size, height: CHIP.size, borderRadius: CHIP.size / 2 },
          selected && { borderColor: ring, borderWidth: 2.5 },
          busy && { opacity: 0.5 },
        ]}
      >
        {/* La sorpresa no enseña su emoji hasta que se usa: parte de la gracia
            es no saber qué va a pasar, y un emoji lo cuenta entero. */}
        <Text style={styles.emoji}>{mode.surprise ? '🎲' : mode.emoji}</Text>
      </View>
      <Text
        numberOfLines={1}
        style={[styles.label, selected ? { color: theme.text } : { color: theme.textDim }]}
      >
        {mode.label}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: theme.hairline,
  },
  emoji: { fontSize: 26 },
  label: { marginTop: 6, fontSize: 11, textAlign: 'center', fontWeight: '600' },
  skeletonRow: { flexDirection: 'row', justifyContent: 'center' },
  skeletonLabel: {
    marginTop: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
});

/**
 * El hueco mientras el modelo mira la foto. Ocupa exactamente lo mismo que el
 * carrusel de verdad, así que cuando llegan los modos no salta nada: es la
 * diferencia entre "está pensando" y "la app se ha roto y luego se ha arreglado".
 */
export const ModeCarouselSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => {
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.75, duration: 620, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 620, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.skeletonRow}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ width: CHIP.size, marginHorizontal: CHIP.gap / 2 }}>
          <Animated.View
            style={[
              styles.chip,
              { width: CHIP.size, height: CHIP.size, borderRadius: CHIP.size / 2, opacity: pulse },
            ]}
          />
          <Animated.View style={[styles.skeletonLabel, { opacity: pulse }]} />
        </View>
      ))}
    </View>
  );
};
