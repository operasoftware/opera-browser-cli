import tiktoken


def count_tokens(text: str, encoding: str) -> int:
    enc = tiktoken.get_encoding(encoding)
    return len(enc.encode(text))
