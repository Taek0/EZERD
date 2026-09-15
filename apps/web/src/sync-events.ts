export type Sequenced = { sequence: number };

/** Applies a contiguous server event stream and fills both interior and final gaps. */
export class SyncEventCursor<T extends Sequenced> {
  private fetching: Promise<void> | undefined;

  constructor(
    private sequence: number,
    private readonly fetchSince: (sequence: number) => Promise<T[]>,
    private readonly apply: (event: T) => void,
  ) {}

  get current() { return this.sequence; }

  async receive(event: T) {
    if (event.sequence <= this.sequence) return;
    if (event.sequence > this.sequence + 1) await this.catchUp();
    if (event.sequence === this.sequence + 1) this.accept(event);
  }

  /** Called for subscribed/head messages, so a dropped final event is observable. */
  async receiveHead(head: number) {
    while (head > this.sequence) {
      const before = this.sequence;
      await this.catchUp();
      if (this.sequence === before) break;
    }
  }

  private async catchUp() {
    if (this.fetching) return this.fetching;
    this.fetching = (async () => {
      const events = (await this.fetchSince(this.sequence)).sort((left, right) => left.sequence - right.sequence);
      for (const event of events) {
        if (event.sequence === this.sequence + 1) this.accept(event);
      }
    })();
    try { await this.fetching; } finally { this.fetching = undefined; }
  }

  private accept(event: T) {
    this.apply(event);
    this.sequence = event.sequence;
  }
}
