const LEASE_KEY = "lucky-draw-v3:writer-lease";
const HEARTBEAT_MS = 1500;
const STALE_MS = 5000;

interface Lease {
  owner: string;
  at: number;
}

function read(): Lease | null {
  try {
    const raw = localStorage.getItem(LEASE_KEY);
    return raw ? (JSON.parse(raw) as Lease) : null;
  } catch {
    return null;
  }
}

function write(lease: Lease): boolean {
  try {
    localStorage.setItem(LEASE_KEY, JSON.stringify(lease));
    return true;
  } catch {
    // Private mode or a full quota. Report the failure rather than assuming
    // the write landed — assuming it did is how two tabs both become owner.
    return false;
  }
}

/**
 * Elects a single writer across tabs.
 *
 * Only the lease holder may commit. v2 let the admin page, the display page,
 * a recovery sweep and a sync hook all write the same records, which is how
 * winners got overwritten.
 *
 * Two rules keep this honest:
 *  - An absent lease does NOT mean "I am the owner". Ownership is only
 *    granted after this tab has written its own id and read it back, so two
 *    tabs racing for a free lease cannot both win.
 *  - Ownership is never claimed when the write itself failed.
 */
export class WriterLease {
  readonly id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  #timer: number | null = null;
  #isOwner = false;
  #active = false;
  #listeners = new Set<(isOwner: boolean) => void>();

  /** Claim the lease if it is free or stale, then keep it alive. */
  acquire() {
    if (this.#active) return;
    this.#active = true;
    this.#tick();
    this.#timer = window.setInterval(() => this.#tick(), HEARTBEAT_MS);
    window.addEventListener("storage", this.#onStorage);
    // pagehide fires for bfcache too, so pageshow has to put us back.
    window.addEventListener("pageshow", this.#onPageShow);
    window.addEventListener("pagehide", this.#onPageHide);
  }

  #onStorage = (e: StorageEvent) => {
    if (e.key === LEASE_KEY) this.#evaluate();
  };

  #onPageShow = () => {
    if (!this.#active) this.acquire();
  };

  #onPageHide = () => {
    // Deliberately not deleting the key: removing it would make every other
    // tab see an absent lease at the same instant. Letting it go stale means
    // exactly one tab wins the claim that follows.
    this.#setOwner(false);
  };

  #tick() {
    const current = read();
    const stale = !current || Date.now() - current.at > STALE_MS;

    if (current?.owner === this.id) {
      // Renew. If the write fails we are no longer safely the owner.
      this.#setOwner(write({ owner: this.id, at: Date.now() }));
      return;
    }

    if (stale) {
      if (!write({ owner: this.id, at: Date.now() })) {
        this.#setOwner(false);
        return;
      }
      // Read back: another tab may have claimed it between our read and our
      // write, and last-write-wins would otherwise leave us both convinced.
      this.#evaluate();
      return;
    }

    this.#setOwner(false);
  }

  #evaluate() {
    const current = read();
    this.#setOwner(current?.owner === this.id);
  }

  #setOwner(next: boolean) {
    if (next === this.#isOwner) return;
    this.#isOwner = next;
    for (const listener of this.#listeners) listener(next);
  }

  get isOwner() {
    return this.#isOwner;
  }

  subscribe(listener: (isOwner: boolean) => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  release = () => {
    if (this.#timer !== null) window.clearInterval(this.#timer);
    this.#timer = null;
    this.#active = false;
    window.removeEventListener("storage", this.#onStorage);
    window.removeEventListener("pageshow", this.#onPageShow);
    window.removeEventListener("pagehide", this.#onPageHide);
    this.#setOwner(false);
  };
}

/**
 * One lease per tab, shared by every page and by the store's write guard.
 * Separate instances would defeat the whole point.
 */
let shared: WriterLease | null = null;

export function getWriterLease(): WriterLease {
  if (!shared) shared = new WriterLease();
  return shared;
}
