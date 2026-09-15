import type { NoticePost } from "../types/clan";

export function SectorOrderCard({ order }: { order: NoticePost }) {
    return <section className="sector-presence sector-panel-card" aria-label="Village Order">
        <div className="sector-panel-card-head"><h4>Village Order</h4><span className="sector-status-pill is-owned">Pinned</span></div>
        <strong>{order.title}</strong>
        <p>{order.body}</p>
        <small>Posted by {order.author} · {order.authorRole}</small>
    </section>;
}
