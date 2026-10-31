package main

import (
	"fmt"
	"os"

	vaos "github.com/christiaan839-beep/verifiable-receipts/packages/verifiable-receipts-go"
)

func main() {
	pemBytes, err := os.ReadFile("ed25519.pem")
	if err != nil {
		panic(err)
	}
	pub, err := vaos.LoadEd25519PublicKeyFromPEM(pemBytes)
	if err != nil {
		panic(err)
	}
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	receipt, err := vaos.ParseReceipt(data)
	if err != nil {
		panic(err)
	}
	result := vaos.VerifyV2Receipt(receipt, pub)
	fmt.Println(result.OK, result.Reason)
}
