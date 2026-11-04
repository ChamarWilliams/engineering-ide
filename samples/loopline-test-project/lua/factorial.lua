local function fact(n)
  if n <= 1 then
    return 1
  end
  return n * fact(n - 1)
end

local total = 0
for i = 1, 4 do
  total = total + fact(i)
end
print(total)
