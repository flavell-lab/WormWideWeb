export const URL_ROOT_ACTIVITY_DATA = "https://storage.googleapis.com/www-deploy-bucket/activity/"

export const CONNECTOME_DATASET_ID_TO_DATASET_NAME = {
    "cook_jarrell_2019_m": "Cook Jarrell 2019 male",
    "cook_jarrell_2019_h": "Cook Jarrell 2019 hermaphrodite",
    "cook_2020": "Cook 2020",
    "white_1986_jse": "White 1986 JSE",
    "white_1986_jsh": "White 1986 JSH",
    "white_1986_n2u": "White 1986 N2U",
    "white_1986_whole": "White 1986 Whole",
    "witvliet_2020_1": "Witvliet 2020 1",
    "witvliet_2020_2": "Witvliet 2020 2",
    "witvliet_2020_3": "Witvliet 2020 3",
    "witvliet_2020_4": "Witvliet 2020 4",
    "witvliet_2020_5": "Witvliet 2020 5",
    "witvliet_2020_6": "Witvliet 2020 6",
    "witvliet_2020_7": "Witvliet 2020 7",
    "witvliet_2020_8": "Witvliet 2020 8",
};

export const URL_CONNECTOME_EDGE = "/connectome/api/get-edges/"

export const cellTypeDict = {
    "s": "Sensory neuron", "i": "Interneuron", "m": "Motor neuron",
    "n": "Neuromodulative neuron", "b": "Muscle", "": "Others", "u": "Others"
}

export const ntTypeDict = {
    "a": "Acetylcholine", "d": "Dopamine", "g": "GABA", "l": "Glutamate",
    "o": "Octopamine", "s": "Serotonin", "t": "Tyramine", "u": "Unknown", "n": "N/A"
}

export const CONNECTOME_DATASET_TYPE = [
    { value: "pharynx", label: "Pharynx" },
    { value: "complete", label: "Complete" },
    { value: "head", label: "Head ganglia" },
    { value: "tail", label: "Tail ganglia" },
]
