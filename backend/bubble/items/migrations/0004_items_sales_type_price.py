"""
Migration: introduce sales_type + unified price field.

Steps:
1. Add `sales_type` (nullable temporarily) and `price` / `price_currency` fields
   to both `item` and `historicalitem`.
2. Data migration: populate sales_type and price from the old fields.
3. Make `sales_type` non-nullable.
4. Drop old `sale_price`, `sale_price_currency`, `rental_price`,
   `rental_price_currency` columns (item + historicalitem).
5. Drop old check constraint; add two new check constraints.
"""

import django.db.models.deletion
import djmoney.models.fields
from django.db import migrations, models


def migrate_prices_forward(apps, schema_editor):
    Item = apps.get_model("items", "Item")
    for item in Item.objects.all():
        if item.sale_price is not None:
            item.sales_type = "sell"
            item.price = item.sale_price
            item.price_currency = item.sale_price_currency
        elif item.rental_price is not None:
            item.sales_type = "rent"
            item.price = item.rental_price
            item.price_currency = item.rental_price_currency
        else:
            # draft items with no price set → sell (price stays null as draft)
            item.sales_type = "sell"
            item.price = None
        item.save(update_fields=["sales_type", "price", "price_currency"])


def migrate_prices_backward(apps, schema_editor):
    Item = apps.get_model("items", "Item")
    for item in Item.objects.all():
        if item.sales_type == "sell" and item.price is not None:
            item.sale_price = item.price
            item.sale_price_currency = item.price_currency
            item.rental_price = None
        elif item.sales_type == "rent" and item.price is not None:
            item.rental_price = item.price
            item.rental_price_currency = item.price_currency
            item.sale_price = None
        else:
            item.sale_price = None
            item.rental_price = None
        item.save(
            update_fields=[
                "sale_price",
                "sale_price_currency",
                "rental_price",
                "rental_price_currency",
            ]
        )


class Migration(migrations.Migration):
    dependencies = [
        (
            "items",
            "0003_historicalitem_visibility_item_visibility",
        ),
    ]

    operations = [
        # ── 1a. Add price + sales_type to Item (sales_type nullable for data migration) ──
        migrations.AddField(
            model_name="item",
            name="price_currency",
            field=djmoney.models.fields.CurrencyField(
                default="EUR",
                editable=False,
                max_length=3,
            ),
        ),
        migrations.AddField(
            model_name="item",
            name="price",
            field=djmoney.models.fields.MoneyField(
                blank=True,
                decimal_places=2,
                max_digits=10,
                null=True,
                help_text="Price for sell/rent items (must be > 0). Leave blank for donate/borrow items.",
            ),
        ),
        migrations.AddField(
            model_name="item",
            name="sales_type",
            field=models.CharField(
                max_length=20,
                null=True,  # temporary – made non-null after data migration
                choices=[
                    ("sell", "Sell"),
                    ("donate", "Donate"),
                    ("rent", "Rent"),
                    ("borrow", "Borrow"),
                    ("want_buy", "Want to Buy"),
                    ("want_rent", "Want to Rent"),
                ],
                help_text=(
                    "How the item is offered: Sell, Donate, Rent, Borrow, "
                    "Want to Buy, or Want to Rent."
                ),
            ),
        ),
        # ── 1b. Mirror fields on HistoricalItem ──
        migrations.AddField(
            model_name="historicalitem",
            name="price_currency",
            field=djmoney.models.fields.CurrencyField(
                default="EUR",
                editable=False,
                max_length=3,
            ),
        ),
        migrations.AddField(
            model_name="historicalitem",
            name="price",
            field=djmoney.models.fields.MoneyField(
                blank=True,
                decimal_places=2,
                max_digits=10,
                null=True,
                help_text="Price for sell/rent items (must be > 0). Leave blank for donate/borrow items.",
            ),
        ),
        migrations.AddField(
            model_name="historicalitem",
            name="sales_type",
            field=models.CharField(
                max_length=20,
                null=True,
                choices=[
                    ("sell", "Sell"),
                    ("donate", "Donate"),
                    ("rent", "Rent"),
                    ("borrow", "Borrow"),
                    ("want_buy", "Want to Buy"),
                    ("want_rent", "Want to Rent"),
                ],
                help_text=(
                    "How the item is offered: Sell, Donate, Rent, Borrow, "
                    "Want to Buy, or Want to Rent."
                ),
            ),
        ),
        # ── 2. Data migration ──
        migrations.RunPython(migrate_prices_forward, migrate_prices_backward),
        # ── 3. Make sales_type non-nullable on Item ──
        migrations.AlterField(
            model_name="item",
            name="sales_type",
            field=models.CharField(
                max_length=20,
                choices=[
                    ("sell", "Sell"),
                    ("donate", "Donate"),
                    ("rent", "Rent"),
                    ("borrow", "Borrow"),
                    ("want_buy", "Want to Buy"),
                    ("want_rent", "Want to Rent"),
                ],
                help_text=(
                    "How the item is offered: Sell, Donate, Rent, Borrow, "
                    "Want to Buy, or Want to Rent."
                ),
            ),
        ),
        # ── 4. Drop old price columns from Item ──
        migrations.RemoveField(model_name="item", name="sale_price"),
        migrations.RemoveField(model_name="item", name="sale_price_currency"),
        migrations.RemoveField(model_name="item", name="rental_price"),
        migrations.RemoveField(model_name="item", name="rental_price_currency"),
        # ── 5. Drop old price columns from HistoricalItem ──
        migrations.RemoveField(model_name="historicalitem", name="sale_price"),
        migrations.RemoveField(model_name="historicalitem", name="sale_price_currency"),
        migrations.RemoveField(model_name="historicalitem", name="rental_price"),
        migrations.RemoveField(
            model_name="historicalitem", name="rental_price_currency"
        ),
        # ── 6. Drop old constraint (if it exists); add new constraints ──
        migrations.RunSQL(
            sql="""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'items_sale_or_rental_price_not_both'
                    ) THEN
                        ALTER TABLE items_item
                            DROP CONSTRAINT items_sale_or_rental_price_not_both;
                    END IF;
                END;
                $$;
            """,
            reverse_sql=migrations.RunSQL.noop,
        ),
        migrations.AddConstraint(
            model_name="item",
            constraint=models.CheckConstraint(
                condition=(
                    ~models.Q(sales_type__in=["sell", "rent"])
                    | models.Q(price__isnull=False)
                ),
                name="items_sell_rent_require_price",
            ),
        ),
        migrations.AddConstraint(
            model_name="item",
            constraint=models.CheckConstraint(
                condition=(
                    ~models.Q(sales_type__in=["donate", "borrow"])
                    | models.Q(price__isnull=True)
                ),
                name="items_donate_borrow_require_null_price",
            ),
        ),
    ]
