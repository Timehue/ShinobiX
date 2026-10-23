import certificateArt from '../assets/festival/broker-certificate-v1.webp';
import { BLACK_MARKET_CERTIFICATE_COST } from '../lib/black-market';
import '../styles/broker-certificates.css';

export function BrokerCertificateReward({ count }: { count: number | undefined }) {
    if (!count || count < 1) return null;
    return <div className="broker-certificate-reward">
        <img src={certificateArt} alt="Parchment certificate with a sealed-crate wax stamp" width={88} height={88}/>
        <div><strong>{count} Broker certificate{count === 1 ? '' : 's'} received</strong>
            <p>Redeem at the Broker for {count === 1 ? 'one half-price sealed crate' : `${count} half-price sealed crates`} at {BLACK_MARKET_CERTIFICATE_COST.toLocaleString()} Ryo each. Each crate counts toward your 10-crate daily limit.</p>
        </div>
    </div>;
}
