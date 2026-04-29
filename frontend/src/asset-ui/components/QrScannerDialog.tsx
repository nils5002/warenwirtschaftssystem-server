import jsQR from 'jsqr';
import { Camera, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type QrScannerDialogProps = {
  title: string;
  onDetected: (value: string) => void;
  onClose: () => void;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

const getBarcodeDetectorCtor = (): BarcodeDetectorCtor | null => {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return candidate ?? null;
};

export function QrScannerDialog({ title, onDetected, onClose }: QrScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const stopRef = useRef(false);
  const [error, setError] = useState<string>('');
  const [status, setStatus] = useState<string>('Kamera wird gestartet ...');

  useEffect(() => {
    stopRef.current = false;

    const cleanup = () => {
      stopRef.current = true;
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };

    const scanFrame = async (detector: { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> } | null) => {
      if (stopRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) {
        timeoutRef.current = window.setTimeout(() => {
          void scanFrame(detector);
        }, 200);
        return;
      }

      let decoded: string | null = null;

      if (detector) {
        try {
          const results = await detector.detect(video);
          decoded = results.find((item) => item.rawValue)?.rawValue?.trim() ?? null;
        } catch {
          decoded = null;
        }
      }

      if (!decoded) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });
          decoded = result?.data?.trim() ?? null;
        }
      }

      if (decoded) {
        cleanup();
        onDetected(decoded);
        return;
      }

      timeoutRef.current = window.setTimeout(() => {
        void scanFrame(detector);
      }, 180);
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Kamera wird von diesem Browser nicht unterstützt.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
          },
          audio: false,
        });
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) {
          cleanup();
          return;
        }

        video.srcObject = stream;
        await video.play();
        setStatus('QR-Code vor die Kamera halten ...');

        const BarcodeDetector = getBarcodeDetectorCtor();
        const detector = BarcodeDetector ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
        void scanFrame(detector);
      } catch {
        setError('Kamera konnte nicht gestartet werden. Bitte Berechtigung prüfen.');
      }
    };

    void start();
    return cleanup;
  }, [onDetected]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">QR-Scanner</p>
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
          <video
            ref={videoRef}
            className="h-[320px] w-full object-cover"
            autoPlay
            muted
            playsInline
          />
        </div>
        <canvas ref={canvasRef} className="hidden" />

        <p className="mt-3 inline-flex items-center gap-2 text-sm text-slate-600">
          <Camera className="h-4 w-4" />
          {error || status}
        </p>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={onClose}
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
