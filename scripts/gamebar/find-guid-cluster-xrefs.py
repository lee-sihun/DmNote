import argparse
import bisect
import json
from pathlib import Path

import pefile
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from capstone.x86 import X86_OP_IMM, X86_OP_MEM, X86_REG_RIP


GUID_LABELS = {
    0x00: "related_iid_a3be5d0a",
    0x10: "hidden_iid_5eac68f9",
    0x20: "hidden_iid_d6332df0",
    0x30: "broker_clsid_59614133",
    0x40: "primary_iid_9767060c",
    0x50: "final_iid_30dad006",
}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--cluster-rva", type=lambda x: int(x, 0), default=0x8F8F00)
    parser.add_argument("--cluster-size", type=lambda x: int(x, 0), default=0x60)
    parser.add_argument("--output")
    return parser.parse_args()


def load_functions(pe, image_base):
    functions = []
    exception_dir = getattr(pe, "DIRECTORY_ENTRY_EXCEPTION", None)
    if not exception_dir:
        return functions

    for entry in exception_dir:
        begin_rva = entry.struct.BeginAddress
        end_rva = entry.struct.EndAddress
        if begin_rva == 0 and end_rva == 0:
            continue
        functions.append(
            {
                "begin_rva": begin_rva,
                "end_rva": end_rva,
                "begin_va": image_base + begin_rva,
                "end_va": image_base + end_rva,
            }
        )

    functions.sort(key=lambda item: item["begin_rva"])
    return functions


def find_function(functions, rva):
    if not functions:
        return None

    starts = [item["begin_rva"] for item in functions]
    idx = bisect.bisect_right(starts, rva) - 1
    if idx < 0:
        return None

    candidate = functions[idx]
    if candidate["begin_rva"] <= rva < candidate["end_rva"]:
        return candidate
    return None


def load_text_section(pe):
    for section in pe.sections:
        name = section.Name.rstrip(b"\x00").decode("ascii", errors="ignore")
        if name == ".text":
            return section
    raise RuntimeError(".text section not found")


def build_instructions(text_va, text_data):
    md = Cs(CS_ARCH_X86, CS_MODE_64)
    md.detail = True
    return list(md.disasm(text_data, text_va))


def classify_target(cluster_va, cluster_size, target, image_base):
    if not (cluster_va <= target < cluster_va + cluster_size):
        return None

    delta = target - cluster_va
    delta16 = (delta // 0x10) * 0x10
    return {
        "target_va": hex(target),
        "target_rva": hex(target - image_base),
        "cluster_offset": hex(delta),
        "cluster_slot": GUID_LABELS.get(delta16, "cluster_blob"),
    }


def summarize_hits(instructions, functions, cluster_va, cluster_size, image_base):
    hits = []

    for idx, insn in enumerate(instructions):
        matched = []
        for operand in insn.operands:
            if operand.type == X86_OP_MEM and operand.mem.base == X86_REG_RIP:
                target = insn.address + insn.size + operand.mem.disp
                classification = classify_target(cluster_va, cluster_size, target, image_base)
                if classification:
                    matched.append({"kind": "rip_mem", **classification})
            elif operand.type == X86_OP_IMM:
                target = operand.imm
                classification = classify_target(cluster_va, cluster_size, target, image_base)
                if classification:
                    matched.append({"kind": "imm", **classification})

        if not matched:
            continue

        function = find_function(functions, insn.address - image_base)
        context = []
        context_start = max(0, idx - 3)
        context_end = min(len(instructions), idx + 4)
        for ctx_idx in range(context_start, context_end):
            ctx = instructions[ctx_idx]
            context.append(
                {
                    "address": hex(ctx.address),
                    "mnemonic": ctx.mnemonic,
                    "op_str": ctx.op_str,
                    "is_hit": ctx_idx == idx,
                }
            )

        hits.append(
            {
                "address": hex(insn.address),
                "rva": hex(insn.address - 0x140000000),
                "mnemonic": insn.mnemonic,
                "op_str": insn.op_str,
                "matches": matched,
                "function": function,
                "context": context,
            }
        )

    return hits


def main():
    args = parse_args()
    binary_path = Path(args.binary)
    pe = pefile.PE(str(binary_path), fast_load=False)
    image_base = pe.OPTIONAL_HEADER.ImageBase
    cluster_va = image_base + args.cluster_rva

    text_section = load_text_section(pe)
    text_va = image_base + text_section.VirtualAddress
    text_data = text_section.get_data()
    functions = load_functions(pe, image_base)
    instructions = build_instructions(text_va, text_data)
    hits = summarize_hits(instructions, functions, cluster_va, args.cluster_size, image_base)

    payload = {
        "binary": str(binary_path),
        "image_base": hex(image_base),
        "cluster_rva": hex(args.cluster_rva),
        "cluster_va": hex(cluster_va),
        "cluster_size": hex(args.cluster_size),
        "hit_count": len(hits),
        "hits": hits,
    }

    text = json.dumps(payload, indent=2)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
