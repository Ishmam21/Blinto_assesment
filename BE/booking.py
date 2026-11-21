def exact_booking(bundle_sizes, group_size):
    """Return the minimum number of bundles and their quantities."""
    unreachable = group_size + 1
    counts = [0] + [unreachable] * group_size
    last_bundle = [0] * (group_size + 1)
    sizes = sorted(bundle_sizes, reverse=True)

    for seats in range(1, group_size + 1):
        for size in sizes:
            if 0 < size <= seats and counts[seats - size] + 1 < counts[seats]:
                counts[seats] = counts[seats - size] + 1
                last_bundle[seats] = size

    if counts[group_size] == unreachable:
        return None, {}

    quantities = {}
    seats = group_size
    while seats:
        size = last_bundle[seats]
        quantities[size] = quantities.get(size, 0) + 1
        seats -= size
    return counts[group_size], quantities
