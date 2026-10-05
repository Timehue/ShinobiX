package com.shinobijourney.app

import android.app.Activity
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryPurchasesParams

/**
 * Reads Play Games Rewards granted outside the game. The server verifies and
 * acknowledges every token; this client never grants an entitlement itself.
 */
class PlayRewardsBillingClient(
    activity: Activity,
    private val rewardProductIds: Set<String>,
    private val deliverReceipts: (List<Map<String, String>>) -> Unit,
) : PurchasesUpdatedListener {
    private val billingClient: BillingClient = BillingClient.newBuilder(activity)
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()

    private var connecting = false
    private var destroyed = false

    fun refreshOnForeground() {
        if (destroyed || connecting) return
        if (billingClient.isReady) {
            queryPurchases()
            return
        }
        connecting = true
        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                connecting = false
                if (!destroyed && result.responseCode == BillingClient.BillingResponseCode.OK) {
                    queryPurchases()
                }
            }

            override fun onBillingServiceDisconnected() {
                connecting = false
                // Billing 8+ automatic reconnection retries on the next API
                // call; the next Activity resume calls refreshOnForeground().
            }
        })
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        if (result.responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
            deliverReceipts(unacknowledgedRewardReceipts(purchases, rewardProductIds))
        }
    }

    private fun queryPurchases() {
        if (destroyed || !billingClient.isReady) return
        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.INAPP)
            .build()
        billingClient.queryPurchasesAsync(params) { result, purchases ->
            if (!destroyed && result.responseCode == BillingClient.BillingResponseCode.OK) {
                deliverReceipts(unacknowledgedRewardReceipts(purchases, rewardProductIds))
            }
        }
    }

    fun close() {
        destroyed = true
        if (billingClient.isReady) billingClient.endConnection()
    }

    companion object {
        internal fun unacknowledgedRewardReceipts(
            purchases: List<Purchase>,
            allowedProductIds: Set<String>,
        ): List<Map<String, String>> = purchases.flatMap { purchase ->
            if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED || purchase.isAcknowledged) return@flatMap emptyList()
            purchase.products
                .filter { it in allowedProductIds }
                .map { productId -> mapOf("productId" to productId, "purchaseToken" to purchase.purchaseToken) }
        }
    }
}
