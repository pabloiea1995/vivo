// La pantalla. Es la única que hay, y eso es la tesis del prototipo: sacar el
// móvil, disparar, elegir y ver el vídeo sin cambiar de sitio ni una vez.
//
// Cinco estados, en un solo sentido:
//
//   live ──disparo──▶ thinking ──GPT──▶ pick ──elección──▶ rendering ──fal──▶ play
//    ▲                                   │                                    │
//    └───────────── otra foto ───────────┴────────────────────────────────────┘
//
// La foto NO se tira al llegar a `play`. Se queda debajo del vídeo (es su
// primer fotograma, literalmente) y sigue viva al volver a `pick`, así que
// probar un segundo modo sobre la misma foto no cuesta ni una foto ni una
// llamada de visión: los cuatro tickets siguen siendo válidos diez minutos.
// Es lo que convierte el juguete en algo que se usa dos veces seguidas.

import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { ModeCarousel, ModeCarouselSkeleton } from '../components/ModeCarousel';
import { Shutter, type ShutterKind } from '../components/Shutter';
import { ClipPlayer } from '../components/ClipPlayer';
import { animate, suggestModes, ApiError, type Clip, type Mode } from '../api/client';
import { theme } from '../theme';

// El encuadre es 9:16 y se respeta a rajatabla: la foto que se ve es la foto
// que se manda, sin recortes de `cover` por el camino. Un preview recortado
// convertiría "el primer fotograma es tu foto" en una verdad a medias, que en
// esta app es la única que no se puede permitir.
const ASPECT = 9 / 16;

// 1080 px de lado largo. Por debajo se nota en el primer fotograma; por encima
// solo engorda un base64 que tiene que subir por la red del móvil y caber en
// el cuerpo de una función de Vercel (4,5 MB).
const UPLOAD_WIDTH = 1080;
const UPLOAD_QUALITY = 0.72;

type Stage = 'live' | 'thinking' | 'pick' | 'rendering' | 'play';

interface Photo {
  uri: string;
  base64: string;
}

export const CameraScreen: React.FC = () => {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const cameraRef = useRef<CameraView>(null);

  const [stage, setStage] = useState<Stage>('live');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [modes, setModes] = useState<Mode[]>([]);
  const [source, setSource] = useState<'vision' | 'catalog'>('vision');
  const [index, setIndex] = useState(0);
  const [clip, setClip] = useState<Clip | null>(null);
  const [muted, setMuted] = useState(true);
  const [showPrompt, setShowPrompt] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const backToLive = useCallback(() => {
    setStage('live');
    setPhoto(null);
    setModes([]);
    setClip(null);
    setIndex(0);
    setShowPrompt(false);
    setNotice(null);
  }, []);

  const shoot = useCallback(async () => {
    if (!cameraRef.current) return;
    setNotice(null);
    setStage('thinking');
    try {
      const shot = await cameraRef.current.takePictureAsync({ quality: 0.9, skipProcessing: false });
      if (!shot?.uri) throw new Error('no_capture');

      // Se reescala ANTES de que la foto exista para el resto de la app: así no
      // hay dos versiones (la de pantalla y la que se manda) que puedan
      // divergir, que es de donde salen los "pero si yo enfoqué otra cosa".
      const prepared = await ImageManipulator.manipulateAsync(
        shot.uri,
        [{ resize: { width: UPLOAD_WIDTH } }],
        { compress: UPLOAD_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!prepared.base64) throw new Error('no_base64');

      const taken: Photo = { uri: prepared.uri, base64: prepared.base64 };
      setPhoto(taken);

      const result = await suggestModes(taken.base64);
      setModes(result.modes);
      setSource(result.source);
      setIndex(0);
      setStage('pick');
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'No se pudo tomar la foto.');
      // Bloqueada por moderación o sin servidor: se vuelve a la cámara. Dejar
      // una foto congelada con un aviso encima es un callejón sin salida.
      setStage('live');
      setPhoto(null);
    }
  }, []);

  const apply = useCallback(
    async (mode: Mode) => {
      if (!photo) return;
      setNotice(null);
      setStage('rendering');
      try {
        const made = await animate(photo.base64, mode);
        setClip(made);
        setMuted(true);
        setStage('play');
      } catch (err) {
        const apiErr = err instanceof ApiError ? err : null;
        setNotice(apiErr?.message || 'No se pudo animar la foto.');
        // Un ticket caducado (diez minutos eligiendo) obliga a repetir la foto;
        // cualquier otro fallo deja el carrusel donde estaba para reintentar.
        if (apiErr?.code === 'invalid_mode') backToLive();
        else setStage('pick');
      }
    },
    [photo, backToLive]
  );

  if (!permission) return <Splash />;
  if (!permission.granted) return <PermissionGate onPress={requestPermission} canAsk={permission.canAskAgain} />;

  const busy = stage === 'thinking' || stage === 'rendering';
  const shutterKind: ShutterKind = stage === 'play' ? 'again' : stage === 'live' ? 'shoot' : 'apply';

  const onShutter = () => {
    if (stage === 'live') return shoot();
    if (stage === 'play') return backToLive();
    if (stage === 'pick' && modes[index]) return apply(modes[index]);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.stage}>
          <View style={[styles.frame, { aspectRatio: ASPECT }]}>
            {stage === 'live' && (
              <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />
            )}

            {/* La foto congelada: es lo que se está analizando, lo que se va a
                animar y —cuando llega el clip— su primer fotograma. La misma
                imagen en las cuatro pantallas, nunca una recreación. */}
            {stage !== 'live' && !!photo && (
              <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            )}

            {stage === 'play' && !!clip && !!photo && (
              <ClipPlayer
                url={clip.url}
                posterUri={photo.uri}
                muted={muted}
                onToggleMute={() => setMuted((m) => !m)}
              />
            )}

            {stage === 'rendering' && <Working label="Animando…" hint="unos 10 segundos" />}
            {stage === 'thinking' && <Working label="Mirando la foto…" />}

            {stage === 'live' && (
              <Pressable
                onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
                style={styles.flip}
                accessibilityRole="button"
                accessibilityLabel="Cambiar de cámara"
              >
                <Text style={styles.flipGlyph}>⟲</Text>
              </Pressable>
            )}
          </View>
        </View>

        <View style={styles.chrome}>
          <StatusLine
            stage={stage}
            source={source}
            clip={clip}
            notice={notice}
            onDismissNotice={() => setNotice(null)}
          />

          {stage === 'thinking' ? (
            <ModeCarouselSkeleton />
          ) : modes.length ? (
            <ModeCarousel
              modes={modes}
              index={index}
              onIndexChange={setIndex}
              onApply={apply}
              disabled={busy || stage === 'play'}
              busyIndex={stage === 'rendering' ? index : null}
            />
          ) : (
            <View style={styles.hintRow}>
              <Text style={styles.hint}>Haz una foto y te propongo cómo animarla</Text>
            </View>
          )}

          <View style={styles.actions}>
            <SideSlot>
              {stage === 'play' && (
                <TextButton label="Otro modo" onPress={() => { setClip(null); setStage('pick'); }} />
              )}
            </SideSlot>

            <Shutter kind={shutterKind} onPress={onShutter} busy={busy} disabled={stage === 'pick' && !modes.length} />

            <SideSlot>
              {stage === 'play' && !!clip?.prompt && (
                <TextButton label={showPrompt ? 'Ocultar' : 'Prompt'} onPress={() => setShowPrompt((v) => !v)} />
              )}
            </SideSlot>
          </View>
        </View>
      </SafeAreaView>

      {/* Lo que se le pidió al modelo, tal cual lo compuso el servidor. En un
          producto esto no se enseña; en un prototipo es la mitad del valor,
          porque es lo que se está afinando. */}
      {showPrompt && !!clip?.prompt && (
        <Pressable style={styles.promptSheet} onPress={() => setShowPrompt(false)}>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <Text style={styles.promptTitle}>{clip.mode}</Text>
            <Text style={styles.promptBody}>{clip.prompt}</Text>
          </ScrollView>
        </Pressable>
      )}
    </View>
  );
};

// ─── piezas pequeñas ─────────────────────────────────────────────────────────

const StatusLine: React.FC<{
  stage: Stage;
  source: 'vision' | 'catalog';
  clip: Clip | null;
  notice: string | null;
  onDismissNotice: () => void;
}> = ({ stage, source, clip, notice, onDismissNotice }) => {
  if (notice) {
    return (
      <Pressable onPress={onDismissNotice} style={styles.noticeRow}>
        <Text style={styles.notice} numberOfLines={2}>{notice}</Text>
      </Pressable>
    );
  }
  // El nombre real de la sorpresa aparece AQUÍ y no antes: el chip decía
  // "Sorpresa", y esto es el chiste contado en el momento correcto.
  if (stage === 'play' && clip) {
    return (
      <View style={styles.noticeRow}>
        <Text style={styles.status} numberOfLines={1}>
          {clip.mode}
          {clip.costEur != null ? ` · ${clip.costEur.toFixed(2)} €` : ''}
        </Text>
      </View>
    );
  }
  if (stage === 'pick' && source === 'catalog') {
    return (
      <View style={styles.noticeRow}>
        <Text style={styles.status}>Modos genéricos (no se pudo analizar la foto)</Text>
      </View>
    );
  }
  return <View style={styles.noticeRow} />;
};

const Working: React.FC<{ label: string; hint?: string }> = ({ label, hint }) => (
  <View style={styles.working}>
    <ActivityIndicator color={theme.text} />
    <Text style={styles.workingLabel}>{label}</Text>
    {!!hint && <Text style={styles.workingHint}>{hint}</Text>}
  </View>
);

const SideSlot: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <View style={styles.sideSlot}>{children}</View>
);

const TextButton: React.FC<{ label: string; onPress: () => void }> = ({ label, onPress }) => (
  <Pressable onPress={onPress} accessibilityRole="button" hitSlop={10}>
    <Text style={styles.textButton}>{label}</Text>
  </Pressable>
);

const Splash: React.FC = () => (
  <View style={[styles.root, styles.center]}>
    <ActivityIndicator color={theme.text} />
  </View>
);

const PermissionGate: React.FC<{ onPress: () => void; canAsk: boolean }> = ({ onPress, canAsk }) => (
  <View style={[styles.root, styles.center, { padding: 32 }]}>
    <Text style={styles.gateTitle}>Necesito la cámara</Text>
    <Text style={styles.gateBody}>
      {canAsk
        ? 'Toda la app es una cámara: sin permiso no hay foto que animar.'
        : 'Actívala en los ajustes del sistema para poder animar tus fotos.'}
    </Text>
    {canAsk && (
      <Pressable onPress={onPress} style={styles.gateButton} accessibilityRole="button">
        <Text style={styles.gateButtonText}>Dar permiso</Text>
      </Pressable>
    )}
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  safe: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  stage: { flex: 1, justifyContent: 'center' },
  frame: { width: '100%', overflow: 'hidden', backgroundColor: '#0a0a0a' },

  chrome: { paddingBottom: 8, backgroundColor: theme.bg },
  hintRow: { height: 92, alignItems: 'center', justifyContent: 'center' },
  hint: { color: theme.textDim, fontSize: 13 },

  noticeRow: { minHeight: 34, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  notice: { color: theme.danger, fontSize: 13, textAlign: 'center' },
  status: { color: theme.textDim, fontSize: 13, textAlign: 'center' },

  actions: { flexDirection: 'row', alignItems: 'center', paddingTop: 14 },
  sideSlot: { flex: 1, alignItems: 'center' },
  textButton: { color: theme.text, fontSize: 14, fontWeight: '600' },

  working: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  workingLabel: { color: theme.text, marginTop: 12, fontSize: 15, fontWeight: '600' },
  workingHint: { color: theme.textDim, marginTop: 4, fontSize: 12 },

  flip: {
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
  flipGlyph: { color: theme.text, fontSize: 20 },

  promptSheet: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.92)' },
  promptTitle: { color: theme.accent, fontSize: 16, fontWeight: '700', marginBottom: 12, marginTop: 40 },
  promptBody: { color: theme.textDim, fontSize: 13, lineHeight: 20 },

  gateTitle: { color: theme.text, fontSize: 20, fontWeight: '700', marginBottom: 10 },
  gateBody: { color: theme.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  gateButton: {
    marginTop: 24,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: theme.accent,
  },
  gateButtonText: { color: theme.accentInk, fontWeight: '700', fontSize: 15 },
});
