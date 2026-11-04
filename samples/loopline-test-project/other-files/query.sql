SELECT owner, SUM(balance) AS total
FROM accounts
WHERE balance > 0
GROUP BY owner
ORDER BY total DESC;
