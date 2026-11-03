#!/usr/bin/env bash
# Runs main.sh under a DEBUG trap; every step appends a marker to stdout and a snapshot to fd 3.
set -T
exec 3>.trace.raw
exec 1>.prog.out
__eide_n=0
declare -A __eide_base

__eide_load_base() {
  local l n
  while IFS= read -r l; do
    case "$l" in
      declare\ *) n=${l#declare -* }; n=${n%%=*}; __eide_base[$n]=1 ;;
    esac
  done < .trace.base
}

__eide_dbg() {
  local __eide_rc=$?
  [ "$2" = "./main.sh" ] || return $__eide_rc
  __eide_n=$((__eide_n + 1))
  if [ "$__eide_n" -gt 1500 ]; then
    echo "@@CUT steps" >&3
    exit 0
  fi
  printf '\001' >&1
  printf '@@STEP %s|%s\n' "$1" "$3" >&3
  declare -p >.trace.tmp 2>/dev/null
  local __eide_l __eide_v __eide_keep=0
  while IFS= read -r __eide_l; do
    case "$__eide_l" in
      declare\ *)
        __eide_v=${__eide_l#declare -* }
        __eide_v=${__eide_v%%=*}
        if [ -z "${__eide_base[$__eide_v]}" ] && [[ "$__eide_v" != __eide* ]] && [[ "$__eide_v" != _ ]]; then
          __eide_keep=1
          printf '%s\n' "$__eide_l" >&3
        else
          __eide_keep=0
        fi
        ;;
      *) [ "$__eide_keep" = 1 ] && printf '%s\n' "$__eide_l" >&3 ;;
    esac
  done < .trace.tmp
  return $__eide_rc
}

declare -p >.trace.base 2>/dev/null
__eide_load_base
trap '__eide_dbg "$LINENO" "${BASH_SOURCE[0]}" "${FUNCNAME[*]}"' DEBUG
source ./main.sh
trap - DEBUG
exit 0
