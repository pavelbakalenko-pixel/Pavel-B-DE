#!/bin/bash
FILE="sales.txt"
if [ ! -f "$FILE" ]; then
    echo "Ошибка: Файл не найден!"
    exit 1
fi

echo "Анализ продаж"
total_sales=$(awk '{ sum += $4 * $5 } END { print sum }' "$FILE")
echo "Общая сумма продаж: $total_sales"

best_day=$(awk '
{
    revenue = $4 * $5
    day_revenue[$1 " " $2] += revenue
}
END {
    max_revenue = 0
    best_day = ""
    for (day in day_revenue) {
        if (day_revenue[day] > max_revenue) {
            max_revenue = day_revenue[day]
            best_day = day
        }
    }
    printf "%s (%d)", best_day, max_revenue
}' "$FILE")

popular_product=$(awk '
{
    quantity = $5
    revenue = $4 * $5
    product_quantity[$3] += quantity
    product_revenue[$3] += revenue
}
END {
    max_quantity = 0
    best_product = ""
    for (product in product_quantity) {
        if (product_quantity[product] > max_quantity) {
            max_quantity = product_quantity[product]
            best_product = product
            best_revenue = product_revenue[product]
        }
    }
    printf "%s (количество проданных единиц: %d, сумма продаж: %d)", best_product, max_quantity, best_revenue
}' "$FILE")
echo -e "\nРезультаты"
echo "Общая сумма продаж: $total_sales"
echo "День с наибольшей выручкой: $best_day"
echo "Популярный товар: $popular_product"








