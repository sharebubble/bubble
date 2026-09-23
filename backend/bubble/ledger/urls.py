from rest_framework.routers import SimpleRouter

from bubble.ledger.api.views import (
    AccountViewSet,
    CategoryViewSet,
    CostShareViewSet,
    DisputeViewSet,
    LedgerViewSet,
    ProjectViewSet,
    ReceiptViewSet,
    TransactionViewSet,
)

router = SimpleRouter()

router.register(
    "ledger/transactions", TransactionViewSet, basename="ledger-transaction"
)
router.register("ledger/accounts", AccountViewSet, basename="ledger-account")
router.register("ledger/categories", CategoryViewSet, basename="ledger-category")
router.register("ledger/projects", ProjectViewSet, basename="ledger-project")
router.register("ledger/disputes", DisputeViewSet, basename="ledger-dispute")
router.register("ledger/splits", CostShareViewSet, basename="ledger-cost-share")
router.register("ledger/receipts", ReceiptViewSet, basename="ledger-receipt")
router.register("ledger", LedgerViewSet, basename="ledger")

urlpatterns = router.urls
