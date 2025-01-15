/*
*   Encoding tuning
*/
function checkTuning(neuron_cat, behavior, tuning, idx_neuron) {
    let list_idx_tune = []
    for (const [key, value] of Object.entries(neuron_cat)) {
        if (value[behavior][tuning].includes(idx_neuron+1)) {
            list_idx_tune.push(key)
        }
      }

    if (list_idx_tune.length > 0) {
        return list_idx_tune.map(i=>`<span>${i}</span>`).join(",    ")
    } else {
        return ""
    }
}

function getTableNeuronLabel(label, idx_neuron, idx_first=false) {
    if (label === "") {
        return `${idx_neuron}`
    } else {
        return idx_first ? `${label} (${idx_neuron})` : `${idx_neuron} (${label})`
    }
}

export function getEncodingTable(data, neuron, skipUnlabeled=false, idxFirst=false) {
    const n_neuron = data["n_neuron"];
    const neuron_cat = data["neuron_categorization"]
    const neuropal_label = data["labeled"];

    const table_encoding_data = [];

    for (let i = 0; i < n_neuron; i++) {
        let idx_neuron = i + 1;
        let label_ = ""
        if (idx_neuron in neuron) {
            label_ = neuron[idx_neuron]["label"]
        }
        
        let enc_change_ = data["encoding_changing_neurons"].includes(idx_neuron) ? "Yes" : "No"

        let tune_v_fwd = checkTuning(neuron_cat, "v", "fwd", i)
        let tune_v_rev = checkTuning(neuron_cat, "v", "rev", i)
        let tune_fwd_slope_p = checkTuning(neuron_cat, "v", "fwd_slope_pos", i)
        let tune_fwd_slope_n = checkTuning(neuron_cat, "v", "fwd_slope_neg", i)
        let tune_rev_slope_p = checkTuning(neuron_cat, "v", "rev_slope_pos", i)
        let tune_rev_slope_n = checkTuning(neuron_cat, "v", "rev_slope_neg", i)
        let tune_slope1 = checkTuning(neuron_cat, "v", "rect_pos", i)
        let tune_slope2 = checkTuning(neuron_cat, "v", "rect_neg", i)

        let tune_dorsal = checkTuning(neuron_cat, "θh", "dorsal", i)
        let tune_ventral = checkTuning(neuron_cat, "θh", "ventral", i)
        let tune_fd = checkTuning(neuron_cat, "θh", "fwd_dorsal", i)
        let tune_fv = checkTuning(neuron_cat, "θh", "fwd_ventral", i)
        let tune_rd = checkTuning(neuron_cat, "θh", "rev_dorsal", i)
        let tune_rv = checkTuning(neuron_cat, "θh", "rev_ventral", i)
        let tune_mdf = checkTuning(neuron_cat, "θh", "rect_dorsal", i)
        let tune_mvf = checkTuning(neuron_cat, "θh", "rect_ventral", i)

        let tune_act = checkTuning(neuron_cat, "P", "act", i)
        let tune_inh = checkTuning(neuron_cat, "P", "inh", i)
        let tune_fa = checkTuning(neuron_cat, "P", "fwd_act", i)
        let tune_fi = checkTuning(neuron_cat, "P", "fwd_inh", i)
        let tune_ra = checkTuning(neuron_cat, "P", "rev_act", i)
        let tune_ri = checkTuning(neuron_cat, "P", "rev_inh", i)
        let tune_maf = checkTuning(neuron_cat, "P", "rect_act", i)
        let tune_mif = checkTuning(neuron_cat, "P", "rect_inh", i)

        if (skipUnlabeled && label_ == "") continue

        table_encoding_data.push({
            "neuron": getTableNeuronLabel(label_, idx_neuron, idxFirst),
            // "label": label_,
            "dataset": data["uid"],
            "id": `${data["uid"]}_${idx_neuron}`,

            "strength_v": data["rel_enc_str_v"][i].toFixed(3),
            "fwdness": data["forwardness"][i].toFixed(2),
            "fwd": tune_v_fwd,
            "rev": tune_v_rev,
            "fwd_slope_p": tune_fwd_slope_p,
            "fwd_slope_n": tune_fwd_slope_n,
            "rev_slope_p": tune_rev_slope_p,
            "rev_slope_n": tune_rev_slope_n,
            "slope_1": tune_slope1,
            "slope_2": tune_slope2,

            "strength_hc": data["rel_enc_str_θh"][i].toFixed(3),
            "dorsalness": data["dorsalness"][i].toFixed(2),
            "dorsal": tune_dorsal,
            "ventral": tune_ventral,
            "fd": tune_fd,
            "fv": tune_fv,
            "rd": tune_rd,
            "rv": tune_rv,
            "mdf": tune_mdf,
            "mvf": tune_mvf,

            "strength_feeding": data["rel_enc_str_P"][i].toFixed(3),
            "feedingness": data["feedingness"][i].toFixed(2),
            "act": tune_act,
            "inh": tune_inh,
            "fa": tune_fa,
            "fi": tune_fi,
            "ra": tune_ra,
            "ri": tune_ri,
            "maf": tune_maf,
            "mif": tune_mif,

            "ewma": data["tau_vals"][i].toFixed(1),
            "enc_change": enc_change_
        })
    }

    return table_encoding_data
}