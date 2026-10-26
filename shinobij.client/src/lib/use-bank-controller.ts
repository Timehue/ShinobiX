import { BANK_INTEREST_WINDOW_MS, projectedBankInterest } from "../../../shared/bank-interest";
import { getBankInterestPercent } from "../lib/village-upgrades";
import { useRef, useState, useSyncExternalStore } from "react";
import { type Character } from "../types/character";
import { sendCurrency, hasPendingTradeIntent, previewCredit, TRADE_CURRENCY_LABELS, TRADE_MINS, TRADE_CAPS, TRADE_TAX_PCT, type TradeCurrency } from "../lib/player-trade";
import { gameConfirm } from "../components/GameAlert";
import { requireServerSettlement } from "../lib/server-settlement-gate";
import { AMBIGUOUS_ACTION_MESSAGE } from "../lib/ambiguous-action";
import { gameToast } from "../components/GameToast";
import { getSharedNow, subscribeSharedNow } from "../lib/shared-now-store";
import { pendingBankTransferIntent, readPendingBankTransferIntent } from "../lib/bank-transfer-intent";
import type { VersionedCharacterCommit } from "../types/character";
import { readVillageTaxEcho, villageTaxNotice } from "../lib/village-tax-echo";

import { transferBankRyo, claimBankInterest, bankTransferRefused, readBankAuthority, readBankSave } from "./bank-api";
import type { BankInterestResponse } from "../../../shared/bank-contract";

const noSubscription = () => () => undefined;

export type BankControllerProps = {
    character: Character;
    onVersionedCharacter: VersionedCharacterCommit;
};

export function useBankController({ character, onVersionedCharacter }: BankControllerProps) {
    const [amount, setAmount] = useState(0);
    const [amountError, setAmountError] = useState<string | null>(null);
    const [recipientError, setRecipientError] = useState<string | null>(null);
    const [sendAmountError, setSendAmountError] = useState<string | null>(null);
    const [interestError, setInterestError] = useState<string | null>(null);
    const amountInput = useRef<HTMLInputElement>(null);
    const recipientInput = useRef<HTMLInputElement>(null);
    const sendAmountInput = useRef<HTMLInputElement>(null);
    const [bankBusy, setBankBusy] = useState(false);
    const bankBusyRef = useRef(false);
    // ── Direct transfer (player-to-player send) state ──
    const [sendTo, setSendTo] = useState("");
    const [sendCurr, setSendCurr] = useState<TradeCurrency>("ryo");
    const [sendAmount, setSendAmount] = useState(0);
    const [sending, setSending] = useState(false);
    const sendingRef = useRef(false);
    const sendBalance = Math.max(0, Math.floor(Number((character as unknown as Record<string, unknown>)[sendCurr] ?? 0)));

    async function submitTransfer() {
        if (sendingRef.current) return;
        const to = sendTo.trim();
        const value = Math.max(0, Math.floor(Number.isFinite(sendAmount) ? sendAmount : 0));
        setRecipientError(null);
        setSendAmountError(null);
        if (!to || to.toLowerCase() === character.name.toLowerCase()) {
            setRecipientError(!to ? "Enter the name of the player to send to." : "You can't send to yourself.");
            recipientInput.current?.focus();
            return;
        }
        const validation = value < TRADE_MINS[sendCurr]
            ? `Minimum transfer is ${TRADE_MINS[sendCurr].toLocaleString()} ${TRADE_CURRENCY_LABELS[sendCurr]}.`
            : value > TRADE_CAPS[sendCurr]
                ? `Maximum per transfer is ${TRADE_CAPS[sendCurr].toLocaleString()} ${TRADE_CURRENCY_LABELS[sendCurr]}.`
                : value > sendBalance && !hasPendingTradeIntent(character.name, to, sendCurr, value)
                    ? `You don't have ${value.toLocaleString()} ${TRADE_CURRENCY_LABELS[sendCurr]}.`
                    : null;
        if (validation) {
            setSendAmountError(validation);
            sendAmountInput.current?.focus();
            return;
        }
        sendingRef.current = true;
        setSending(true);
        try {
            if (!(await gameConfirm(`Send ${value.toLocaleString()} ${TRADE_CURRENCY_LABELS[sendCurr]} to ${to}? They receive ${previewCredit(value).toLocaleString()} after a ${Math.round(TRADE_TAX_PCT * 100)}% transfer tax.`))) return;
            const res = await sendCurrency(character.name, to, sendCurr, value);
            if (!res.ok) return alert(res.error || "Could not send.");
            // A replay can carry an old balance. Read current authority and let
            // the coordinator reject replies for a newer save or another login.
            const authority = await readBankSave(character.name, res._saveVersion).catch(() => null);
            if (authority) onVersionedCharacter({ ...character, ...authority.character } as Character, authority._saveVersion);
            setSendAmount(0);
            setSendTo("");
            if (!authority) return alert("Transfer confirmed. Your balance could not be refreshed. Reload to see your current funds.");
            if (res.duplicate) return gameToast("That transfer was already sent. Your balance is up to date.");
            gameToast(`Sent ${(res.debit ?? value).toLocaleString()} ${TRADE_CURRENCY_LABELS[sendCurr]} to ${res.toPlayer ?? to}. They received ${(res.credit ?? 0).toLocaleString()} (${(res.burned ?? 0).toLocaleString()} burned as tax).`);
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    }
    const interestPercent = getBankInterestPercent(character);
    const lastClaim = character.lastBankInterestAt ?? 0;
    const nextClaimAt = lastClaim + BANK_INTEREST_WINDOW_MS;
    // canClaimInterest is the only thing on this screen that reads the clock,
    // and it can only change while an eligible claim is still ahead. So, like
    // useLiveActionDeadline, subscribe to the one-second display clock only
    // then, instead of re-rendering the whole Bank every second. The stored
    // clock is read without subscribing to decide; a stale reading can only
    // ever start one extra tick, which refreshes it.
    const interestEligible = character.bankRyo > 0 && interestPercent > 0;
    const claimAhead = interestEligible && nextClaimAt > getSharedNow();
    const now = useSyncExternalStore(claimAhead ? subscribeSharedNow : noSubscription, getSharedNow, getSharedNow);
    const canClaimInterest = interestEligible && now >= nextClaimAt;
    const projectedInterest = projectedBankInterest(character.bankRyo, interestPercent);
    const interestStatus = canClaimInterest
        ? projectedInterest > 0 ? "Ready now" : "Deposit too small"
        : interestPercent <= 0
            ? "Upgrade required"
            : character.bankRyo <= 0
                ? "Deposit required"
                : new Date(nextClaimAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

    async function moveRyo(direction: "deposit" | "withdraw") {
        if (direction === "deposit" && !requireServerSettlement("bankDeposit")) return;
        // Number.isFinite guard: a non-numeric input yields NaN, and `NaN > ryo`
        // is false — without this the transfer would proceed and write `ryo - NaN
        // = NaN`, corrupting the save.
        const value = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
        const pending = readPendingBankTransferIntent(character.name, direction, value);
        const validation = value <= 0
            ? "Enter a positive amount."
            : !pending && direction === "deposit" && value > character.ryo
                ? "Not enough ryo. Enter an amount within your wallet balance."
                : !pending && direction === "withdraw" && value > character.bankRyo
                    ? "Not enough banked ryo. Enter an amount within your vault balance."
                    : null;
        if (validation) {
            setAmountError(validation);
            amountInput.current?.focus();
            return;
        }
        setAmountError(null);
        if (bankBusyRef.current) return;
        bankBusyRef.current = true;
        setBankBusy(true);
        const intent = pendingBankTransferIntent(character.name, direction, value);
        try {
            const reply = await transferBankRyo(character.name, direction, value, intent.requestId);
            const { data, error, status } = reply;
            // The day's occupation tax, assessed by the server before the move
            // (2026-10 rebalance). A refusal still carries it: adopt its balances
            // and stamped version so the next autosave is not stale.
            const villageTax = readVillageTaxEcho(data ?? error);
            const taxNotice = villageTaxNotice(villageTax);
            if (villageTax?._saveVersion && !data) {
                const authority = await readBankAuthority(character.name).catch(() => null);
                if (authority) onVersionedCharacter({ ...character, ...authority.character } as Character, authority._saveVersion);
            }
            if (taxNotice) gameToast(taxNotice);
            if (!data) {
                // A rate limit or expired login can arrive after the first
                // attempt committed and lost its response. Keep that receipt ID
                // until the server confirms the outcome of this same operation.
                if (bankTransferRefused(reply)) intent.complete();
                return alert(error && status >= 400 && status < 500 && status !== 408
                    ? error.error
                    : AMBIGUOUS_ACTION_MESSAGE);
            }
            // The server confirmed this transfer. A newer save adopted first can get
            // its commit refused as stale (the coordinator then reads the stored
            // save back), but the move is done, so release the intent either way.
            // Game fields outside this envelope remain the server's save shape;
            // the coordinator rejects foreign accounts and stale versions.
            onVersionedCharacter(data.character as Character, data._saveVersion);
            intent.complete();
            setAmount(0);
            setInterestError(null);
            gameToast(data.replayed ? "Transfer already completed. Your balance is up to date." : direction === "deposit"
                ? `Deposited ${value.toLocaleString()} ryo to your vault.`
                : `Withdrew ${value.toLocaleString()} ryo to your wallet.`);
        } catch {
            alert(AMBIGUOUS_ACTION_MESSAGE);
        } finally {
            bankBusyRef.current = false;
            setBankBusy(false);
        }
    }

    async function claimInterest() {
        if (bankBusyRef.current) return;
        const validation = interestPercent <= 0
            ? "Upgrade the Bank in Town Hall to earn interest."
            : character.bankRyo <= 0
                ? "Deposit ryo first."
                : Date.now() < nextClaimAt
                    ? `Interest can be claimed again at ${new Date(nextClaimAt).toLocaleString()}.`
                    : projectedInterest <= 0
                        ? "Your deposit is too small to earn interest yet."
                        : null;
        if (validation) return setInterestError(validation);
        setInterestError(null);
        // Server-authoritative (audit #7 / Stage 3 Phase 4f): the server recomputes
        // the interest from the SAVED bankRyo + bank-upgrade rate under the save
        // lock and stamps lastBankInterestAt against its own clock, so the client
        // can no longer inflate the amount or replay via a rolled-back clock.
        // Adopt the character and version together, including late/unmounted replies.
        bankBusyRef.current = true;
        setBankBusy(true);
        let data: BankInterestResponse;
        try {
            const reply = await claimBankInterest(character.name);
            if (reply.data) {
                const authority = await readBankAuthority(character.name, reply.data);
                onVersionedCharacter({ ...character, ...authority.character } as Character, authority._saveVersion);
            }
            // The day's occupation tax, assessed by the server first (2026-10
            // rebalance): adopt its post-tax wallet, and on a refusal its
            // stamped version too, so the next autosave is not stale.
            const villageTax = readVillageTaxEcho(reply.data ?? reply.error);
            if (villageTax) {
                if (villageTax._saveVersion && !reply.data) {
                    const authority = await readBankAuthority(character.name).catch(() => null);
                    if (authority) onVersionedCharacter({ ...character, ...authority.character } as Character, authority._saveVersion);
                }
                const taxNotice = villageTaxNotice(villageTax);
                if (taxNotice) gameToast(taxNotice);
            }
            if (!reply.data) return alert(reply.error && reply.status >= 400 && reply.status < 500 && reply.status !== 408
                ? reply.error.error
                : AMBIGUOUS_ACTION_MESSAGE);
            data = reply.data;
        } catch {
            return alert(AMBIGUOUS_ACTION_MESSAGE);
        } finally {
            bankBusyRef.current = false;
            setBankBusy(false);
        }
        if (data.eligible === false) {
            // The server says which gate refused the claim (api/_bank-interest.ts
            // computeBankInterest); name it rather than a blanket "try later".
            const serverNextClaimAt = Number(data.nextClaimAt);
            return alert(data.reason === "no-upgrade"
                ? "Your village has no Bank upgrade yet, so the vault pays no interest."
                : data.reason === "empty"
                    ? "Deposit ryo in the vault first. Interest is paid on what the vault holds."
                    : data.reason === "cooldown" && Number.isFinite(serverNextClaimAt) && serverNextClaimAt > 0
                        ? `Interest is ready again at ${new Date(serverNextClaimAt).toLocaleString()}.`
                        : data.reason === "too-small"
                            ? "Your vault balance is too small to earn interest yet."
                            : "Bank interest isn't available yet — try again later.");
        }
        gameToast(`Bank interest claimed: +${data.claimed.toLocaleString()} ryo.`);
    }

    return { amount, setAmount, amountError, setAmountError, amountInput, bankBusy, moveRyo,
        recipientError, setRecipientError, sendAmountError, setSendAmountError, recipientInput, sendAmountInput,
        sendTo, setSendTo, sendCurr, setSendCurr, sendAmount, setSendAmount, sending, sendBalance, submitTransfer,
        interestPercent, projectedInterest, interestStatus, canClaimInterest, interestError, claimInterest };
}
