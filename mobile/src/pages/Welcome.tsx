import { FaSolidQrcode } from "solid-icons/fa";

function Welcome(props: { onPair: () => void }) {
  return (
    <div class="flex h-full w-full flex-col items-center justify-between p-6 pb-10">
      <div class="flex flex-1 flex-col items-center justify-center gap-3">
        <div class="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface-2">
          <span class="text-3xl font-semibold tracking-widest text-text">A</span>
        </div>
        <span class="text-4xl tracking-widest text-text" style={{ "font-family": "Libre Baskerville, serif" }}>
          Axiom
        </span>
        <p class="text-center text-[0.9rem] text-text-faint">
          Bilgisayarındaki sohbetlere buradan eriş
        </p>
      </div>

      <button
        onClick={props.onPair}
        class="flex w-full items-center justify-center gap-2 rounded-xl border border-border-hover bg-surface-2 py-3.5 text-[1.1rem] text-text active:scale-[0.98]"
      >
        <FaSolidQrcode size={20} stroke-width={1} />
        <span>Cihaz eşleştir</span>
      </button>
    </div>
  );
}

export default Welcome;
