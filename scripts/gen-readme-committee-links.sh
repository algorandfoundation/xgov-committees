#!/usr/bin/env bash

# Generates mainnet commitee file links for the README
# Places the generated file in the README marked section

cd "$(realpath "$(dirname "$0")")"
cd ..
COM_PATH=data/mainnet-v1.0-wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8_/committee
cd $COM_PATH

OUT=""

echo -e "Generating committee file index for README.md\n"

# walk committee filenames, process mainnet committee files
# assumes no duplicates will be found (e.g. from a manual copy)
for filename in *.json; do
  gh=$(jq -r .networkGenesisHash "$filename")
  if [[ "$gh" == "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=" ]]; then
    echo -n "Processing $filename"
    registryId=$(jq -r .registryId $filename)
    periodStart=$(jq -r .periodStart $filename)
    periodEnd=$(jq -r .periodEnd $filename)
    cd ../../../
    # Get the committee ID by running the main script
    C_ID=$(REGISTRY_APP_ID=$registryId FIRST_BLOCK=$periodStart LAST_BLOCK=$periodEnd DATA_PATH=data ALGOD_SERVER=https://mainnet-api.4160.nodely.dev ./run.sh | grep -oE 'Committee ID: [^ ]+$' | awk '{ print $3 }' )
    cd - > /dev/null
    if [ "$C_ID" == "" ]; then
      echo "Failed to get committee ID for $filename"
      exit 1
    fi
    OUT+=$'\n'"- $periodStart-$periodEnd: [$C_ID](https://raw.githubusercontent.com/algorandfoundation/xgov-committees/refs/heads/main/$COM_PATH/$filename)"
  fi
done

OUT+=$'\n'
echo "$OUT"

cd ../../..

# replace text in README
sed -i '/<!-- BEGIN COMMITTEE AUTOGEN -->/,/<!-- END COMMITTEE AUTOGEN -->/{
/<!-- BEGIN COMMITTEE AUTOGEN -->/{
p
r /dev/stdin
}
/<!-- END COMMITTEE AUTOGEN -->/p
d
}' README.md <<< "$OUT"

echo "Wrote to README.md"
