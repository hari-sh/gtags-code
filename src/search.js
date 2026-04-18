const createLongHeap = (capacity) => {
    // Using Float64Array for 64-bit precision without BigInt conversion overhead
    const data = new Float64Array(capacity * 3);
    let size = 0;

    const swap = (i, j) => {
        for (let k = 0; k < 3; k++) {
            let temp = data[i * 3 + k];
            data[i * 3 + k] = data[j * 3 + k];
            data[j * 3 + k] = temp;
        }
    };

    return {
        push: (val, arrIdx, eleIdx) => {
            let i = size * 3;
            data[i] = val;
            data[i + 1] = arrIdx;
            data[i + 2] = eleIdx;

            let curr = size++;
            while (curr > 0) {
                let parent = (curr - 1) >> 1;
                if (data[curr * 3] >= data[parent * 3]) break;
                swap(curr, parent);
                curr = parent;
            }
        },
        pop: () => {
            const res = [data[0], data[1], data[2]];
            size--;
            if (size > 0) {
                data.set(data.subarray(size * 3, size * 3 + 3), 0);
                let curr = 0;
                while (true) {
                    let left = (curr << 1) + 1;
                    let right = (curr << 1) + 2;
                    let smallest = curr;
                    if (left < size && data[left * 3] < data[smallest * 3]) smallest = left;
                    if (right < size && data[right * 3] < data[smallest * 3]) smallest = right;
                    if (smallest === curr) break;
                    swap(curr, smallest);
                    curr = smallest;
                }
            }
            return res;
        },
        peekValue: () => data[0],
        isEmpty: () => size === 0
    };
};

/**
 * @param {Array<Array<Array<bigint|number>>>} groups - The 3D data structure.
 * @param {AbortSignal} signal - The signal from an AbortController.
 */
const getSmallest20IntersectionWithAbort = (groups, signal) => {
    // Immediate exit if already aborted
    if (signal?.aborted) return;

    const numGroups = groups.length;
    if (numGroups === 0) return [];

    const heaps = groups.map(group => {
        const h = createLongHeap(group.length);
        group.forEach((arr, idx) => {
            if (arr.length > 0) h.push(arr[0], idx, 0);
        });
        return h;
    });

    const results = [];
    const currentValues = new Float64Array(numGroups);

    for (let i = 0; i < numGroups; i++) {
        if (heaps[i].isEmpty()) return [];
        currentValues[i] = heaps[i].peekValue();
    }

    while (results.length < 20) {
        // ABORT CHECK: Check at the start of every result discovery cycle
        if (signal?.aborted) return;

        let maxVal = currentValues[0];
        for (let i = 1; i < numGroups; i++) {
            if (currentValues[i] > maxVal) maxVal = currentValues[i];
        }

        let allSame = true;
        for (let i = 0; i < numGroups; i++) {
            while (currentValues[i] < maxVal) {
                const [_, arrIdx, eleIdx] = heaps[i].pop();
                const nextIdx = eleIdx + 1;
                if (nextIdx < groups[i][arrIdx].length) {
                    heaps[i].push(groups[i][arrIdx][nextIdx], arrIdx, nextIdx);
                }

                if (heaps[i].isEmpty()) return results;
                currentValues[i] = heaps[i].peekValue();
            }
            if (currentValues[i] !== maxVal) allSame = false;
        }

        if (allSame) {
            results.push(maxVal);

            for (let i = 0; i < numGroups; i++) {
                const matchVal = maxVal;
                while (!heaps[i].isEmpty() && heaps[i].peekValue() <= matchVal) {
                    const [_, arrIdx, eleIdx] = heaps[i].pop();
                    if (eleIdx + 1 < groups[i][arrIdx].length) {
                        heaps[i].push(groups[i][arrIdx][eleIdx + 1], arrIdx, eleIdx + 1);
                    }
                }

                if (heaps[i].isEmpty()) {
                    if (results.length < 20) return results;
                } else {
                    currentValues[i] = heaps[i].peekValue();
                }
            }
        }
    }

    return results;
};

module.exports = {
    getSmallest20IntersectionWithAbort
};